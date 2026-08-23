import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildReport } from "./classify.js";
import { loadConfig } from "./config.js";
import { buildEmail, sendSummaryEmail } from "./email.js";
import { scanRenderedAnnouncements } from "./scrape.js";
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
      skipped: 0,
      duplicatesRemoved: 0,
      detailAttempts: 0,
      detailSuccesses: 0,
      detailFailures: 0,
    },
    relevantAnnouncements: [],
    skippedAnnouncements: [],
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

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: "zh-TW",
      timezoneId: config.timezone,
      userAgent: "school-anouncement-notifier/1.0 (+GitHub Actions)",
    });
    const page = await context.newPage();
    scanResult = await scanRenderedAnnouncements({ page, config, now });
    report = buildReport(scanResult.notices, now, config.lookbackHours);

    if (report.relevant.length > 0 && scanResult.success) {
      const message = buildEmail({ dateKey: taipeiDateKey(now), report });
      email = await sendSummaryEmail({ ...message, config, env });
    } else if (scanResult.allReadMethodsFailed || !scanResult.page.renderedPageSuccess || scanResult.partial) {
      email = noEmail("公告頁讀取失敗／無法完整判斷；僅記錄 log，不寄送掃描狀態信");
    } else if (report.relevant.length === 0) {
      email = noEmail("今日無相關公告；僅記錄 log，不寄送掃描狀態信");
    }

    const status = scanResult.allReadMethodsFailed || !scanResult.page.renderedPageSuccess
      ? "read_failure"
      : scanResult.partial
        ? "partial_scan"
        : report.relevant.length > 0
          ? "relevant_found"
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
        skipped: report.counts.skipped,
        duplicatesRemoved: report.counts.duplicatesRemoved,
        detailAttempts: scanResult.counts.detailAttempts,
        detailSuccesses: scanResult.counts.detailSuccesses,
        detailFailures: scanResult.counts.detailFailures,
      },
      relevantAnnouncements: report.relevant,
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
