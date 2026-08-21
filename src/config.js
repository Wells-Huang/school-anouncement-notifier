export const CATEGORY_NAMES = [
  "榮譽榜",
  "校務公告",
  "獎補助資訊",
  "公文公告",
  "活動/競賽",
  "研習進修",
  "人事服務",
  "音樂班聯招",
  "教師甄選",
];

export const DEFAULT_CONFIG = {
  pageUrl: "https://www.gtes.tp.edu.tw/nss/p/index",
  timezone: "Asia/Taipei",
  // The recipient must be supplied through GMAIL_TO; never commit it here.
  recipient: "",
  lookbackHours: 24,
  maxPagesPerCategory: 20,
  // "all" is the default because the detail page contains the authoritative
  // last-updated date. "recent" is available for quick local smoke tests.
  detailScanMode: "all",
  navigationTimeoutMs: 45_000,
  detailTimeoutMs: 20_000,
};

function numberFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function loadConfig(env = process.env) {
  const config = {
    ...DEFAULT_CONFIG,
    pageUrl: env.SCHOOL_ANNOUNCEMENT_URL || DEFAULT_CONFIG.pageUrl,
    recipient: env.GMAIL_TO || DEFAULT_CONFIG.recipient,
    lookbackHours: numberFromEnv("LOOKBACK_HOURS", DEFAULT_CONFIG.lookbackHours),
    maxPagesPerCategory: numberFromEnv(
      "MAX_PAGES_PER_CATEGORY",
      DEFAULT_CONFIG.maxPagesPerCategory,
    ),
    detailScanMode: env.DETAIL_SCAN_MODE === "recent" ? "recent" : "all",
    navigationTimeoutMs: numberFromEnv(
      "NAVIGATION_TIMEOUT_MS",
      DEFAULT_CONFIG.navigationTimeoutMs,
    ),
    detailTimeoutMs: numberFromEnv(
      "DETAIL_TIMEOUT_MS",
      DEFAULT_CONFIG.detailTimeoutMs,
    ),
  };

  return config;
}
