const TAIPEI_OFFSET_MINUTES = 8 * 60;

function partsFor(date, timeZone = "Asia/Taipei") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
}

export function taipeiDateKey(date = new Date()) {
  const parts = partsFor(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatTaipeiDateTime(date = new Date()) {
  const parts = partsFor(date);
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function toTaipeiIso(date = new Date()) {
  const parts = partsFor(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`;
}

function normalizeYear(year) {
  const numeric = Number(year);
  return numeric < 1000 ? numeric + 1911 : numeric;
}

function taipeiLocalDateToUtc(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(
    Date.UTC(normalizeYear(year), Number(month) - 1, Number(day), hour, minute, second) -
      TAIPEI_OFFSET_MINUTES * 60_000,
  );
}

export function parseTaipeiDateOnly(value, referenceDate = new Date()) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  let match = text.match(/(\d{3,4})\s*[年\/-](\d{1,2})\s*[月\/-](\d{1,2})/u);
  if (!match) {
    match = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/u);
    if (match) {
      const current = partsFor(referenceDate);
      match = [match[0], current.year, match[1], match[2]];
    }
  }
  if (!match) return null;

  const year = normalizeYear(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = taipeiLocalDateToUtc(year, month, day);
  if (Number.isNaN(date.getTime())) return null;

  return {
    date,
    dateOnly: true,
    isoDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    display: `${String(year).padStart(4, "0")}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`,
    raw: match[0],
  };
}

export function parseAnyDate(value, referenceDate = new Date()) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/u.test(text)) return parsed;
  return parseTaipeiDateOnly(text, referenceDate)?.date ?? null;
}

export function isExactWithinRecentWindow(date, now = new Date(), hours = 24) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const start = now.getTime() - hours * 60 * 60 * 1000;
  return date.getTime() >= start && date.getTime() <= now.getTime() + 5 * 60 * 1000;
}

export function isDateOnlyWithinRecentWindow(dateOnly, now = new Date(), hours = 24) {
  const parsed = typeof dateOnly === "string" ? parseTaipeiDateOnly(dateOnly, now) : dateOnly;
  if (!parsed?.date) return false;
  const start = now.getTime() - hours * 60 * 60 * 1000;
  const end = now.getTime() + 5 * 60 * 1000;
  const dayStart = parsed.date.getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;
  return dayEnd >= start && dayStart <= end;
}

export function maxDateOnly(values = [], referenceDate = new Date()) {
  return values
    .map((value) => (value?.isoDate ? value : parseTaipeiDateOnly(value, referenceDate)))
    .filter(Boolean)
    .sort((a, b) => a.isoDate.localeCompare(b.isoDate))
    .at(-1) ?? null;
}
