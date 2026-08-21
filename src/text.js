export function stripHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeForMatch(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s，。,.、：:；;！!？?（）()「」『』【】［］《》〈〉…·\-—_]/g, "");
}

export function truncate(value = "", maxLength = 240) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function firstUsefulSentences(value = "", maxLength = 260, maxSentences = 2) {
  const text = normalizeText(value).replace(/\n+/g, "。 ");
  if (!text) return "";
  const chunks = text
    .split(/(?<=[。！？!?])\s*/u)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .slice(0, maxSentences);
  return truncate(chunks.join(" ") || text, maxLength);
}

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
