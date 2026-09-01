import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildReport } from "./classify.js";
import { loadConfig } from "./config.js";
import { buildEmail, sendSummaryEmail } from "./email.js";
import { scanRenderedAnnouncements } from "./scrape.js";
import {
  loadSentState,
  markSuccessfullySent,
  partitionAnnouncementsBySentState,
  saveSentState,
} from "./sent-state.js";
import { formatTaipeiDateTime, taipeiDateKey, toTaipeiIso } from "./time.js";

function logFileStamp(date = new Date()) {
  return `${taipeiDateKey(date)}-${formatTaipeiDateTime(date).slice(11).replaceAll(":", "")}`;
}

async function writeRunLogs(log, now) {
  const directory = join(process.cwd(), "logs", taipeiDateKey(now));
  await mkdir(directory, { recursive: true });
  const archivePath = join(directory, `scan-${logFileStamp(now)}-${log.runId}.json`);
  const latestPath = join(process.cwd(), "logs", "latest.json");
  const data = `${JSON.stringify({
    ...log,
    logFiles: { archivePath, latestPath },
  }, null, 2)}\n`;
  await writeFile(archivePath, data, "utf8");
  await writeFile(latestPath, data, "utf8");
  return { archivePath, latestPath };
}

function noEmail(reason) {
  return { attempted: false, sent: false, reason };
}

function buildFailureLog({ runId, startedAt, now, config, error }) {
  return {
    runId,
    execution: {
      startedAtUtc: startedAt.toISOString(),
      completedAtUtc: now.toISOString(),
      executedAtTaipei: formatTaipeiDateTime(now),
      timezone: config.timezone,
    },
    source: { pageUrl: config.pageUrl },
    methods: ["rendered page", "RSS", "搜尋引擎備援"],
    page: {
      opened: false,
      renderedPageSuccess: false,
      announcementListSuccess: false,
      failureReason: error instanceof Error ? error.message : String(error),
    },
    categories: { requested: [], successful: [], failed: [] },
    counts: {
      scanned: 0,
      recent24h: 0,
      relevant: 0,
      newRelevant: 0,
      alreadySent: 0,
      sameVersionDuplicates: 0,
      skipped: 0,
      duplicatesRemoved: 0,
      detailAttempts: 0,
      detailSuccesses: 0,
      detailFailures: 0,
    },
    relevantAnnouncements: [],
    emailAnnouncements: [],
    alreadySentAnnouncements: [],
    sameVersionDuplicateAnnouncements: [],
    skippedAnnouncements: [],
    sentState: {
      safeToSend: false,
      saved: false,
      reason: "掃描流程失敗，未變更已寄送狀態",
    },
    email: noEmail("公告頁讀取失敗／無法判斷；僅記錄 log，不寄送掃描狀態信"),
    status: "read_failure",
    failureReason: `公告頁讀取失敗／無法判斷：${error instanceof Error ? error.message : String(error)}`,
  };
}

export async function run({ now = new Date(), env = process.env } = {}) {
  const config = loadConfig(env);
  const runId = randomUUID();
  const startedAt = new Date();
  let browser;
  let scanResult;
  let report;
  let email = null;
  let log;
  const sentStatePath = join(process.cwd(), "state", "sent-announcements.json");
  const logsDirectory = join(process.cwd(), "logs");

  try {
    const sentStateLoad = await loadSentState({ statePath: sentStatePath, logsDirectory });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "zh-TW",
      timezoneId: config.timezone,
      userAgent: "school-anouncement-notifier/1.0 (+GitHub Actions)",
    });
    const page = await context.newPage();
    scanResult = await scanRenderedAnnouncements({ page, config, now });
    report = buildReport(scanResult.notices, now, config.lookbackHours);
    const delivery = partitionAnnouncementsBySentState(report.relevant, sentStateLoad.state);
    const deliveryReport = {
      ...report,
      relevant: delivery.pending,
      counts: {
        ...report.counts,
        relevant: delivery.pending.length,
      },
    };

    if (scanResult.allReadMethodsFailed || !scanResult.page.renderedPageSuccess || scanResult.partial) {
      email = noEmail("公告頁讀取失敗／無法完整判斷；僅記錄 log，不寄送掃描狀態信");
    } else if (!sentStateLoad.safeToSend && report.relevant.length > 0) {
      email = noEmail("已寄送狀態讀取失敗／無法安全判斷新舊公告；僅記錄 log，不寄送");
    } else if (delivery.pending.length > 0 && scanResult.success) {
      const message = buildEmail({ dateKey: taipeiDateKey(now), report: deliveryReport });
      email = await sendSummaryEmail({ ...message, config, env });
    } else if (report.relevant.length > 0 && delivery.pending.length === 0) {
      email = noEmail("符合條件公告皆已成功通知；僅記錄 log，不重複寄送");
    } else if (report.relevant.length === 0) {
      email = noEmail("今日無相關公告；僅記錄 log，不寄送掃描狀態信");
    }

    const sentAt = new Date().toISOString();
    const marked = markSuccessfullySent(sentStateLoad.state, delivery.pending, {
      emailSent: email?.sent === true,
      sentAt,
    });
    const sentStateStatus = {
      path: "state/sent-announcements.json",
      loadedFromFile: sentStateLoad.loadedFromFile,
      safeToSend: sentStateLoad.safeToSend,
      readError: sentStateLoad.readError,
      recordsBeforeImport: sentStateLoad.recordsBeforeImport,
      recordsAfterImport: sentStateLoad.recordsAfterImport,
      historicalLogsRead: sentStateLoad.history.filesRead,
      historicalSuccessfulLogs: sentStateLoad.history.successfulLogs,
      historicalVersionsImported: sentStateLoad.history.imported,
      historicalVersionsRefreshed: sentStateLoad.history.refreshed,
      historyErrors: sentStateLoad.history.errors,
      markedAfterEmailSuccess: marked.added,
      recordsAfterRun: marked.total,
      saved: false,
      saveError: "",
    };
    const shouldSaveState = sentStateLoad.safeToSend && (
      !sentStateLoad.loadedFromFile || sentStateLoad.dirty || marked.added > 0
    );
    sentStateStatus.saveNeeded = shouldSaveState;
    sentStateStatus.saveReason = shouldSaveState
      ? ""
      : sentStateLoad.safeToSend
        ? "已寄送狀態無變更"
        : "狀態不安全，拒絕覆寫";
    if (shouldSaveState) {
      try {
        await saveSentState(sentStatePath, sentStateLoad.state);
        sentStateStatus.saved = true;
        sentStateStatus.saveReason = "已儲存已寄送狀態";
      } catch (error) {
        sentStateStatus.saveError = error instanceof Error ? error.message : String(error);
        sentStateStatus.saveReason = "已寄送狀態儲存失敗";
      }
    }

    const status = scanResult.allReadMethodsFailed || !scanResult.page.renderedPageSuccess
      ? "read_failure"
      : scanResult.partial
        ? "partial_scan"
        : !sentStateLoad.safeToSend && report.relevant.length > 0
          ? "sent_state_failure"
          : delivery.pending.length > 0
            ? "relevant_found"
            : report.relevant.length > 0
              ? "already_notified"
              : "no_related_announcements";

    log = {
      runId,
      execution: {
        startedAtUtc: startedAt.toISOString(),
        completedAtUtc: new Date().toISOString(),
        executedAtTaipei: formatTaipeiDateTime(now),
        timezone: config.timezone,
        windowStartUtc: new Date(now.getTime() - config.lookbackHours * 60 * 60 * 1000).toISOString(),
        windowEndUtc: now.toISOString(),
      },
      source: { pageUrl: config.pageUrl },
      methods: scanResult.methods,
      page: scanResult.page,
      categories: scanResult.categories,
      counts: {
        scanned: scanResult.counts.scanned,
        recent24h: report.counts.recent24h,
        relevant: report.counts.relevant,
        newRelevant: delivery.pending.length,
        alreadySent: delivery.alreadySent.length,
        sameVersionDuplicates: delivery.sameVersionDuplicates.length,
        skipped: report.counts.skipped,
        duplicatesRemoved: report.counts.duplicatesRemoved,
        detailAttempts: scanResult.counts.detailAttempts,
        detailSuccesses: scanResult.counts.detailSuccesses,
        detailFailures: scanResult.counts.detailFailures,
      },
      relevantAnnouncements: report.relevant,
      emailAnnouncements: delivery.pending,
      alreadySentAnnouncements: delivery.alreadySent.map(({ notice, previous }) => ({
        title: notice.title,
        publishedDate: notice.publishedDate,
        updatedDate: notice.updatedDate,
        category: notice.category,
        originalUrl: notice.originalUrl,
        firstSentAt: previous.firstSentAt || previous.lastSentAt,
        lastSentAt: previous.lastSentAt,
        reason: "相同原始公告連結與更新日期已成功寄送",
      })),
      sameVersionDuplicateAnnouncements: delivery.sameVersionDuplicates.map(({ notice }) => ({
        title: notice.title,
        publishedDate: notice.publishedDate,
        updatedDate: notice.updatedDate,
        category: notice.category,
        originalUrl: notice.originalUrl,
        reason: "本次掃描已有相同原始公告連結與更新日期，僅保留一則",
      })),
      skippedAnnouncements: report.skipped,
      rss: scanResult.rss
        ? {
            success: true,
            sourceUrl: scanResult.rss.sourceUrl,
            itemCount: scanResult.rss.items.length,
            lastBuildDate: scanResult.rss.lastBuildDate,
          }
        : { success: false },
      email,
      sentState: sentStateStatus,
      status,
      noEmailReason: email?.sent ? "" : email?.reason || "",
      failureReason: scanResult.failureReason || "",
    };
  } catch (error) {
    log = buildFailureLog({ runId, startedAt, now, config, error });
  } finally {
    await browser?.close().catch(() => {});
  }

  const paths = await writeRunLogs(log, now);
  console.log(JSON.stringify({ ...log, logFiles: paths }, null, 2));
  return { log, paths };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
