import { fetchRss } from "./rss.js";
import { isDateOnlyWithinRecentWindow, parseTaipeiDateOnly } from "./time.js";
import { normalizeText, stripHtml, truncate } from "./text.js";
import { CATEGORY_NAMES } from "./config.js";

export class ScanError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ScanError";
    this.details = details;
  }
}

function cssAttribute(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function categorySelector(category) {
  return `a[role="tab"][title="${cssAttribute(category)}"]`;
}

function extractAfterLabel(text, label) {
  return normalizeText(String(text || "").replace(label, "").replace(/\|/g, ""));
}

function extractOriginalUrl(href) {
  if (!href) return "";
  const match = String(href).match(/^mailto:\?body=(.+)$/u);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1].replace(/&amp;/g, "&"));
  } catch {
    return match[1];
  }
}

function findRssMatch(items, notice) {
  if (!items?.length) return null;
  const exactMatches = items.filter((item) => item.title === notice.title);
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) {
    const listDate = parseTaipeiDateOnly(notice.listDate)?.date?.getTime() ?? Number.NaN;
    return [...exactMatches].sort((a, b) => {
      const aDate = a.pubDate?.getTime() ?? Number.NaN;
      const bDate = b.pubDate?.getTime() ?? Number.NaN;
      const aDistance = Number.isFinite(listDate) && Number.isFinite(aDate)
        ? Math.abs(aDate - listDate)
        : Number.POSITIVE_INFINITY;
      const bDistance = Number.isFinite(listDate) && Number.isFinite(bDate)
        ? Math.abs(bDate - listDate)
        : Number.POSITIVE_INFINITY;
      return aDistance - bDistance;
    })[0];
  }
  const normalized = normalizeText(notice.title);
  return items.find((item) => normalizeText(item.title) === normalized) || null;
}

function likelyRecentFromList(notice, now, hours) {
  const parsed = parseTaipeiDateOnly(notice.listDate, now);
  return Boolean(parsed && isDateOnlyWithinRecentWindow(parsed, now, hours));
}

async function currentCategoryTitles(page) {
  return page.locator('a[role="tab"][title]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("title")).filter(Boolean),
  );
}

async function makeVisible(page, category, maxSteps = CATEGORY_NAMES.length + 3) {
  const seen = new Set();
  for (let step = 0; step < maxSteps; step += 1) {
    const titles = await currentCategoryTitles(page);
    if (titles.includes(category)) return true;
    const signature = titles.join("|");
    if (seen.has(signature)) break;
    seen.add(signature);
    const next = page.locator('button[aria-label="下一個"]').first();
    if (!(await next.count()) || !(await next.isEnabled())) break;
    await next.click({ timeout: 10_000 });
    await page.waitForTimeout(180);
  }
  return false;
}

async function activeCategory(page, category) {
  const selector = categorySelector(category);
  const active = page.locator(`li.tdset.active:has(${selector})`).first();
  if (await active.count()) return active;
  return page.locator(selector).locator("xpath=ancestor::li[1]").first();
}

async function selectCategory(page, category) {
  if (!(await makeVisible(page, category))) {
    throw new ScanError(`找不到公告分類：${category}`, { category });
  }
  const link = page.locator(categorySelector(category)).first();
  const previousFirstRow = await page.locator("li.tdset.active tbody tr").first().innerText().catch(() => "");
  await link.click({ timeout: 15_000 });
  // The tab's aria-selected state changes before the Vue table finishes its
  // asynchronous fetch. Do not read the previous category's table.
  await page.waitForTimeout(1_200);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const selected = await link.getAttribute("aria-selected").catch(() => null);
    const active = await activeCategory(page, category);
    const tableCount = await active.locator("table").count();
    const firstRow = await active.locator("tbody tr").first().innerText().catch(() => "");
    const tableSettled = firstRow !== previousFirstRow || attempt >= 5;
    if (selected === "true" && tableCount > 0 && tableSettled) return active;
    await page.waitForTimeout(200);
  }
  throw new ScanError(`公告分類未完成載入：${category}`, { category });
}

async function closeDetail(page) {
  // The site labels this control visually as 「回上一頁」. It is not an
  // aria-labelled close button in the current site markup.
  const close = page.locator("button").filter({ hasText: "回上一頁" }).first();
  if (await close.count()) {
    await close.click({ timeout: 10_000 });
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await page.locator("#printHere").count())) return;
      await page.waitForTimeout(100);
    }
  }
}

async function readDetail(page, rowLocator, timeoutMs, expectedTitle = "") {
  const link = rowLocator.locator("a").first();
  await link.click({ timeout: timeoutMs });
  const detailRoot = page.locator("#printHere").first();
  await detailRoot.waitFor({ state: "visible", timeout: timeoutMs });

  const title = normalizeText(await detailRoot.locator("h3").first().innerText().catch(() => ""));
  const unitText = await detailRoot.locator('span[remark="發布單位："]').first().locator("xpath=..").innerText().catch(() => "");
  const body = normalizeText(await detailRoot.locator("div.htmldisplay").first().innerText().catch(() => ""));
  const publishedText = await detailRoot.locator('span[remark="發佈日期："]').first().locator("xpath=..").innerText().catch(() => "");
  const updatedText = await detailRoot.locator('span[remark="最後更新日期："]').first().locator("xpath=..").innerText().catch(() => "");
  // The share/mail link sits beside #printHere rather than inside it.
  const originalMailto = await page.locator('a[href^="mailto:"]').first().getAttribute("href").catch(() => "");
  const attachments = await detailRoot.locator("a[download]").evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("download") || element.textContent || "").map((value) => value.trim()).filter(Boolean),
  ).catch(() => []);

  const result = {
    read: true,
    title,
    unit: extractAfterLabel(unitText, "發布單位："),
    body,
    publishedDate: extractAfterLabel(publishedText, "發佈日期："),
    lastUpdatedDate: extractAfterLabel(updatedText, "最後更新日期："),
    originalUrl: extractOriginalUrl(originalMailto),
    attachments,
  };
  if (expectedTitle && title && normalizeText(title) !== normalizeText(expectedTitle)) {
    await closeDetail(page).catch(() => {});
    throw new ScanError("詳細頁標題與公告列表不一致，拒絕使用可能錯配的內容", {
      expectedTitle,
      detailTitle: title,
    });
  }
  await closeDetail(page);
  return result;
}

async function tableSignature(active) {
  const firstRows = await active.locator("tbody tr").evaluateAll((rows) =>
    rows.slice(0, 3).map((row) => row.innerText.trim()).join("||"),
  ).catch(() => "");
  const currentPage = await active.locator("button[disabled]").allTextContents().catch(() => []);
  return `${currentPage.join("|")}::${firstRows}`;
}

async function readRowsOnPage(page, active, category, options) {
  const rows = active.locator("tbody tr");
  const count = await rows.count();
  const notices = [];
  let detailAttempts = 0;
  let detailSuccesses = 0;
  let detailFailures = 0;

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const cells = await row.locator("td").allTextContents();
    if (cells.length < 3) continue;
    const title = normalizeText(cells[0]);
    const unit = normalizeText(cells[1]);
    const listDate = normalizeText(cells[2]);
    if (!title || !listDate) continue;

    const notice = { category, title, unit, listDate, detail: null, originalUrl: "" };
    const rssMatch = findRssMatch(options.rssItems, notice);
    if (rssMatch) notice.rss = rssMatch;
    const shouldReadDetail =
      options.detailScanMode === "all" ||
      likelyRecentFromList(notice, options.now, options.lookbackHours) ||
      Boolean(rssMatch?.pubDate && rssMatch.pubDate.getTime() >= options.now.getTime() - options.lookbackHours * 60 * 60 * 1000);

    if (shouldReadDetail) {
      detailAttempts += 1;
      try {
        notice.detail = await readDetail(page, row, options.detailTimeoutMs, title);
        notice.body = notice.detail.body || "";
        notice.originalUrl = notice.detail.originalUrl || rssMatch?.link || "";
        detailSuccesses += 1;
      } catch (error) {
        detailFailures += 1;
        notice.detail = { read: false, error: error instanceof Error ? error.message : String(error) };
        await closeDetail(page).catch(() => {});
      }
    }
    notices.push(notice);
  }

  return { notices, detailAttempts, detailSuccesses, detailFailures };
}

async function scanCategory(page, category, options) {
  const notices = [];
  let detailAttempts = 0;
  let detailSuccesses = 0;
  let detailFailures = 0;
  const signatures = new Set();

  for (let pageNumber = 1; pageNumber <= options.maxPagesPerCategory; pageNumber += 1) {
    const active = await activeCategory(page, category);
    const firstSignature = (await tableSignature(active)) || `page-${pageNumber}`;
    const signature = `${pageNumber}|${firstSignature}`;
    if (signatures.has(signature)) break;
    signatures.add(signature);

    const pageResult = await readRowsOnPage(page, active, category, options);
    notices.push(...pageResult.notices);
    detailAttempts += pageResult.detailAttempts;
    detailSuccesses += pageResult.detailSuccesses;
    detailFailures += pageResult.detailFailures;

    const next = active.locator('button[aria-label="下一頁"]').first();
    if (!(await next.count()) || !(await next.isEnabled())) break;
    await next.click({ timeout: 15_000 });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const refreshed = await activeCategory(page, category);
      const nextSignature = await tableSignature(refreshed);
      if (nextSignature && nextSignature !== firstSignature) break;
      await page.waitForTimeout(200);
    }
  }

  return { notices, detailAttempts, detailSuccesses, detailFailures };
}

async function searchEngineBackup(pageUrl) {
  const query = encodeURIComponent(`site:${new URL(pageUrl).hostname} 古亭國小 公告`);
  const url = `https://www.google.com/search?q=${query}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "school-anouncement-notifier/1.0" },
    });
    const body = await response.text();
    return {
      attempted: true,
      success: response.ok,
      url,
      status: response.status,
      summary: truncate(stripHtml(body), 300),
      usableForNoAnnouncement: false,
    };
  } catch (error) {
    return {
      attempted: true,
      success: false,
      url,
      summary: error instanceof Error ? error.message : String(error),
      usableForNoAnnouncement: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function scanRenderedAnnouncements({ page, config, now = new Date() }) {
  const methods = ["rendered page"];
  const pageStatus = {
    opened: false,
    renderedPageSuccess: false,
    announcementListSuccess: false,
    responseStatus: null,
    jsShellDetected: false,
    jsShellSummary: "",
    rssUrl: "",
    rssSuccess: false,
    rssItemCount: 0,
    searchEngineBackup: null,
  };
  const categoryStatus = [];
  const notices = [];
  let rssResult = null;
  let failureReason = "";
  let detailAttempts = 0;
  let detailSuccesses = 0;
  let detailFailures = 0;

  try {
    const response = await page.goto(config.pageUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    });
    pageStatus.opened = true;
    pageStatus.responseStatus = response?.status() ?? null;
    await page.locator('a[aria-label="RSS訂閱"]').waitFor({ state: "attached", timeout: config.navigationTimeoutMs });

    const rssLocator = page.locator('a[aria-label="RSS訂閱"]').first();
    pageStatus.rssUrl = (await rssLocator.getAttribute("href")) || "";
    if (pageStatus.rssUrl) {
      methods.push("RSS");
      try {
        rssResult = await fetchRss(pageStatus.rssUrl);
        pageStatus.rssSuccess = true;
        pageStatus.rssItemCount = rssResult.items.length;
      } catch (error) {
        failureReason = `RSS 讀取失敗：${error instanceof Error ? error.message : String(error)}`;
      }
    }

    let bodyText = "";
    try {
      await page.locator("li.tdset table").first().waitFor({ state: "visible", timeout: config.navigationTimeoutMs });
      bodyText = await page.locator("body").innerText();
    } catch (error) {
      bodyText = await page.locator("body").innerText().catch(() => "");
      const jsShell = /本頁面需要瀏覽器支持\s*JavaScript|需要瀏覽器支持\s*JavaScript/iu.test(bodyText);
      pageStatus.jsShellDetected = jsShell;
      pageStatus.jsShellSummary = truncate(bodyText, 300);
      throw new ScanError(
        jsShell ? "公告頁只回傳 JavaScript 提示，未取得公告表格" : "公告表格未在等待時間內載入",
        { jsShellSummary: pageStatus.jsShellSummary, cause: error instanceof Error ? error.message : String(error) },
      );
    }

    const tableCount = await page.locator("li.tdset table").count();
    const jsShell = /本頁面需要瀏覽器支持\s*JavaScript|需要瀏覽器支持\s*JavaScript/iu.test(bodyText);
    pageStatus.jsShellDetected = jsShell;
    pageStatus.jsShellSummary = jsShell ? truncate(bodyText, 300) : "";
    if (jsShell && tableCount === 0) {
      throw new ScanError("公告頁只回傳 JavaScript 提示，未取得公告表格", {
        jsShellSummary: pageStatus.jsShellSummary,
      });
    }
    pageStatus.renderedPageSuccess = true;
    pageStatus.announcementListSuccess = tableCount > 0;

    for (const category of CATEGORY_NAMES) {
      try {
        await selectCategory(page, category);
        const categoryResult = await scanCategory(page, category, {
          ...config,
          now,
          rssItems: rssResult?.items || [],
        });
        notices.push(...categoryResult.notices);
        detailAttempts += categoryResult.detailAttempts;
        detailSuccesses += categoryResult.detailSuccesses;
        detailFailures += categoryResult.detailFailures;
        categoryStatus.push({ category, success: true, notices: categoryResult.notices.length });
      } catch (error) {
        categoryStatus.push({
          category,
          success: false,
          notices: 0,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    failureReason = error instanceof Error ? error.message : String(error);
    if (error instanceof ScanError && error.details?.jsShellSummary) {
      pageStatus.jsShellSummary = error.details.jsShellSummary;
    }
  }

  const successfulCategories = categoryStatus.filter((item) => item.success).map((item) => item.category);
  const failedCategories = categoryStatus.filter((item) => !item.success);
  const allReadMethodsFailed = !pageStatus.renderedPageSuccess && !pageStatus.rssSuccess;
  if (allReadMethodsFailed) {
    methods.push("搜尋引擎備援");
    pageStatus.searchEngineBackup = await searchEngineBackup(config.pageUrl);
  }

  // Merge RSS content/link into rendered rows. RSS is never used as evidence
  // that there are no announcements; it only enriches a rendered row.
  for (const notice of notices) {
    if (!notice.rss && rssResult?.items?.length) {
      notice.rss = findRssMatch(rssResult.items, notice);
    }
    if (!notice.originalUrl) notice.originalUrl = notice.detail?.originalUrl || notice.rss?.link || "";
    if (!notice.body && notice.rss?.description) notice.body = notice.rss.description;
  }

  return {
    methods: [...new Set(methods)],
    page: pageStatus,
    categories: {
      requested: CATEGORY_NAMES,
      successful: successfulCategories,
      failed: failedCategories,
    },
    notices,
    rss: rssResult,
    counts: {
      scanned: notices.length,
      detailAttempts,
      detailSuccesses,
      detailFailures,
    },
    success: pageStatus.renderedPageSuccess && successfulCategories.length === CATEGORY_NAMES.length,
    partial: pageStatus.renderedPageSuccess && failedCategories.length > 0,
    allReadMethodsFailed,
    failureReason,
  };
}
