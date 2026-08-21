import {
  isDateOnlyWithinRecentWindow,
  isExactWithinRecentWindow,
  maxDateOnly,
  parseAnyDate,
  parseTaipeiDateOnly,
} from "./time.js";
import {
  firstUsefulSentences,
  normalizeForMatch,
  normalizeText,
  truncate,
} from "./text.js";

const KEYWORDS = [
  ["五年級", 5],
  ["5年級", 5],
  ["高年級", 4],
  ["三至六年級", 5],
  ["四至六年級", 5],
  ["四到六年級", 5],
  ["學生", 2],
  ["學童", 2],
  ["兒少", 2],
  ["家長", 3],
  ["親子", 3],
  ["報名", 3],
  ["繳費", 4],
  ["期限", 3],
  ["注意事項", 2],
  ["校外教學", 5],
  ["課後照顧", 5],
  ["課後班", 5],
  ["社團", 4],
  ["營隊", 4],
  ["比賽", 4],
  ["徵件", 4],
  ["展覽", 3],
  ["閱讀", 3],
  ["科學", 3],
  ["音樂", 3],
  ["美術", 3],
  ["資訊", 3],
  ["AI", 3],
  ["資優", 4],
  ["英語", 3],
  ["健康檢查", 5],
  ["視力", 4],
  ["疫苗", 5],
  ["午餐", 5],
  ["請假", 5],
  ["酷課", 3],
  ["親子綁定", 5],
  ["校園安全", 5],
  ["交通", 4],
  ["接送", 5],
  ["停課", 6],
  ["補課", 5],
  ["助學金", 4],
  ["獎學金", 4],
  ["餐食", 4],
  ["書包", 4],
];

const PARTICIPATION_TERMS = [
  "活動",
  "比賽",
  "營隊",
  "展覽",
  "徵件",
  "課程",
  "閱讀",
  "科學",
  "音樂",
  "美術",
  "資訊",
  "ai",
  "資優",
  "英語",
  "社團",
];

const FAMILY_TERMS = [
  "五年級",
  "5年級",
  "高年級",
  "三至六年級",
  "四至六年級",
  "四到六年級",
  "學生",
  "學童",
  "兒少",
  "家長",
  "親子",
  "健康檢查",
  "視力",
  "疫苗",
  "午餐",
  "請假",
  "酷課",
  "親子綁定",
  "校園安全",
  "交通",
  "接送",
  "停課",
  "補課",
  "書包",
  "餐食",
  "助學金",
  "獎學金",
];

const URGENT_TERMS = [
  "報名",
  "繳費",
  "期限",
  "截止",
  "回覆",
  "填寫",
  "接送",
  "請假",
  "停課",
  "補課",
  "健康檢查",
  "疫苗",
  "校外教學",
  "課後照顧",
  "課後班",
  "親子綁定",
];

const EXCLUSION_TERMS = [
  "教師研習",
  "研習進修",
  "人事徵才",
  "代理教師甄選",
  "教師甄選",
  "採購招標",
  "主計",
  "人事室",
  "教師專用系統",
  "工程公告",
  "校內行政",
];

function containsAny(haystack, terms) {
  return terms.filter((term) => haystack.includes(normalizeForMatch(term)));
}

function parseDateCandidates(text, referenceDate) {
  const candidates = [];
  const patterns = [
    /(?<year>\d{3,4})\s*年\s*(?<month>\d{1,2})\s*月\s*(?<day>\d{1,2})\s*日?/gu,
    /(?<year>20\d{2})\s*[/.\-]\s*(?<month>\d{1,2})\s*[/.\-]\s*(?<day>\d{1,2})/gu,
    /(?<month>\d{1,2})\s*月\s*(?<day>\d{1,2})\s*日/gu,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0];
      const parsed = parseTaipeiDateOnly(raw, referenceDate);
      if (!parsed) continue;
      const start = Math.max(0, (match.index ?? 0) - 45);
      const end = Math.min(text.length, (match.index ?? 0) + raw.length + 45);
      candidates.push({
        raw,
        index: match.index ?? 0,
        display: parsed.display,
        isoDate: parsed.isoDate,
        date: parsed.date,
        context: normalizeText(text.slice(start, end)),
      });
    }
  }

  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.isoDate}|${candidate.context}`;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
}

function deadlineScore(item, text) {
  const before = text.slice(Math.max(0, item.index - 60), item.index);
  const beforeShort = text.slice(Math.max(0, item.index - 14), item.index);
  const after = text.slice(item.index + item.raw.length, item.index + item.raw.length + 60);
  const afterShort = text.slice(item.index + item.raw.length, item.index + item.raw.length + 14);
  let score = 0;

  if (/截止|期限|收件截止|繳費期限|回覆期限/iu.test(`${before}${after}`)) score += 4;
  if (/[前止]/u.test(afterShort)) score += 4;
  // Handles forms such as 「即日起至115年8月24日（星期一）止」.
  if (/[至到]/u.test(beforeShort) && /止|截止|前/iu.test(after)) score += 5;
  if (/報名|繳費|回覆|收件|申請|報到/iu.test(before) && (/[前止]/u.test(after) || /[至到]/u.test(beforeShort))) {
    score += 2;
  }
  return score;
}

function findDeadline(dates, text, now) {
  const matching = dates
    .map((item) => ({ ...item, deadlineScore: deadlineScore(item, text) }))
    .filter((item) => item.deadlineScore > 0);
  const today = now.toISOString().slice(0, 10);
  return matching
    .filter((item) => item.isoDate >= today)
    .sort((a, b) => b.deadlineScore - a.deadlineScore || a.isoDate.localeCompare(b.isoDate))[0]
    ?? matching.sort((a, b) => b.deadlineScore - a.deadlineScore || b.isoDate.localeCompare(a.isoDate))[0]
    ?? null;
}

export function getRecentState(notice, now = new Date(), hours = 24) {
  if (notice.rss?.pubDate && isExactWithinRecentWindow(notice.rss.pubDate, now, hours)) {
    return { recent: true, precision: "timestamp", source: "RSS pubDate" };
  }

  const dateOnly = maxDateOnly(
    [notice.detail?.lastUpdatedDate, notice.listDate, notice.detail?.publishedDate].filter(Boolean),
    now,
  );
  if (dateOnly && isDateOnlyWithinRecentWindow(dateOnly, now, hours)) {
    return { recent: true, precision: "date-only", source: "rendered page/detail date" };
  }

  return {
    recent: false,
    precision: notice.rss?.pubDate ? "timestamp" : "date-only",
    source: notice.rss?.pubDate ? "RSS pubDate" : "rendered page/detail date",
  };
}

export function classifyNotice(notice, now = new Date()) {
  const title = normalizeText(notice.title);
  const body = normalizeText(notice.body || notice.rss?.description || "");
  const combined = normalizeForMatch(`${title}\n${body}`);
  const matched = KEYWORDS.filter(([term]) => combined.includes(normalizeForMatch(term))).map(([term]) => term);
  const participation = containsAny(combined, PARTICIPATION_TERMS);
  const family = containsAny(combined, FAMILY_TERMS);
  const urgentTerms = containsAny(combined, URGENT_TERMS);
  const exclusions = containsAny(combined, EXCLUSION_TERMS);
  const dates = parseDateCandidates(`${title}\n${body}`, now);
  const deadline = findDeadline(dates, `${title}\n${body}`, now);
  const expired = Boolean(deadline && deadline.isoDate < now.toISOString().slice(0, 10));

  const lowerGradeOnly =
    /幼兒園|幼兒|小一新生|一年級新生|國小一年級|低年級/iu.test(title) &&
    !/二至六|三至六|四至六|高年級|五年級|六年級/iu.test(`${title}\n${body}`);

  const teacherOnly =
    (exclusions.length > 0 || ["研習進修", "人事服務", "教師甄選"].includes(notice.category)) &&
    !/學生|學童|兒少|家長|親子|小朋友|兒童|五年級|高年級|三至六|四至六|國小生/iu.test(`${title}\n${body}`);

  const hasOperation = containsAny(combined, [
    "健康檢查",
    "視力",
    "疫苗",
    "午餐",
    "請假",
    "酷課",
    "親子綁定",
    "校園安全",
    "交通",
    "接送",
    "停課",
    "補課",
    "書包",
    "餐食",
  ]);
  const strongFamily = family.length > 0;
  const strongParticipation = participation.length > 0 && strongFamily;
  const relevant = !expired && !lowerGradeOnly && !teacherOnly && (
    (strongFamily && (strongParticipation || hasOperation.length > 0 || urgentTerms.length > 0)) ||
    (strongParticipation && matched.length > 0) ||
    (hasOperation.length > 0 && /家長|學生|學童|國小生|兒少|小朋友|兒童/iu.test(`${title}\n${body}`)) ||
    (matched.includes("助學金") || matched.includes("獎學金"))
  );

  let bucket = "家長知道即可";
  if (urgentTerms.length > 0 && (strongFamily || hasOperation.length > 0) && !expired) {
    bucket = "今天必看";
  } else if (strongParticipation && !expired) {
    bucket = "適合女兒參加";
  }

  const reasonParts = [];
  if (family.length) reasonParts.push(`提到${family.slice(0, 3).join("、")}`);
  if (participation.length) reasonParts.push(`屬於${participation.slice(0, 2).join("、")}`);
  if (hasOperation.length) reasonParts.push(`涉及${hasOperation.slice(0, 2).join("、")}`);
  if (deadline) reasonParts.push(`有重要日期：${deadline.display}`);
  const reason = reasonParts.length
    ? `${reasonParts.join("；")}，與小五學生或家長的安排有關。`
    : "公告內容與學生／家長可能需要留意的校務資訊相關。";

  let action = "請閱讀原公告，確認是否需要依校方或主辦單位指示辦理。";
  if (deadline) {
    action = `請留意${deadline.display}前的報名、繳費、回覆或收件要求，並依原公告辦理。`;
  } else if (hasOperation.includes("接送") || hasOperation.includes("交通") || hasOperation.includes("請假")) {
    action = "請依公告日期調整接送、交通或請假安排。";
  } else if (hasOperation.includes("疫苗") || hasOperation.includes("健康檢查") || hasOperation.includes("視力")) {
    action = "請留意學校後續通知；若需家長同意或配合，請依通知回覆。";
  } else if (strongParticipation) {
    action = "若女兒有興趣，請查看簡章、資格與期限，再決定是否報名或準備作品。";
  }

  const summary = firstUsefulSentences(body, 280, 2) || "詳細內容請見原公告。";
  const priority = bucket === "今天必看" ? "高" : bucket === "適合女兒參加" ? "中" : "低";

  return {
    relevant,
    bucket,
    priority,
    title,
    publishedDate: notice.detail?.publishedDate || notice.listDate || "",
    updatedDate: notice.detail?.lastUpdatedDate || notice.listDate || "",
    category: notice.category,
    unit: notice.unit || notice.detail?.unit || "",
    reason,
    action,
    deadline: deadline?.display || "無明確截止日期",
    importantDates: dates.map((date) => ({ date: date.display, context: date.context })),
    originalUrl: notice.originalUrl || notice.rss?.link || "",
    summary,
    matchedKeywords: matched,
    exclusionMatches: exclusions,
    expired,
    detailRead: Boolean(notice.detail?.read),
    datePrecision: notice.recent?.precision || "date-only",
  };
}

export function buildReport(notices, now = new Date(), lookbackHours = 24) {
  const recent = notices
    .map((notice) => ({ ...notice, recent: getRecentState(notice, now, lookbackHours) }))
    .filter((notice) => notice.recent.recent);

  const classified = recent.map((notice) => classifyNotice(notice, now));
  const relevant = classified
    .filter((item) => item.relevant)
    .sort((a, b) => {
      const priority = { 高: 0, 中: 1, 低: 2 };
      return priority[a.priority] - priority[b.priority] || a.title.localeCompare(b.title, "zh-Hant");
    });
  const skipped = classified
    .filter((item) => !item.relevant)
    .map((item) => ({
      title: item.title,
      category: item.category,
      reason: item.expired ? "已截止" : item.exclusionMatches.length ? "教師／行政等低優先內容" : "未達相關條件",
    }));

  return {
    recent,
    relevant,
    skipped,
    counts: {
      scanned: notices.length,
      recent24h: recent.length,
      relevant: relevant.length,
      skipped: skipped.length,
    },
  };
}
