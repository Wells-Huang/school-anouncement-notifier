import { XMLParser } from "fast-xml-parser";
import { stripHtml, normalizeText } from "./text.js";

function valueOf(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    return String(value.__cdata ?? value["#text"] ?? value.text ?? "");
  }
  return "";
}

export function extractGuidFromUrl(url = "") {
  const match = String(url).match(/\/([a-z0-9]{20,40})(?:[/?#]|$)/iu);
  return match?.[1] ?? "";
}

export function parseRssXml(xml, sourceUrl = "") {
  const parser = new XMLParser({
    ignoreAttributes: false,
    cdataPropName: "__cdata",
    processEntities: true,
    trimValues: false,
  });
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item ?? [];
  const items = (Array.isArray(rawItems) ? rawItems : [rawItems]).map((item) => {
    const link = valueOf(item.link).trim();
    const title = normalizeText(valueOf(item.title));
    const descriptionHtml = valueOf(item.description);
    const pubDateRaw = valueOf(item.pubDate).trim();
    const pubDate = pubDateRaw ? new Date(pubDateRaw) : null;
    return {
      title,
      descriptionHtml,
      description: stripHtml(descriptionHtml),
      link,
      guid: valueOf(item.guid).trim() || extractGuidFromUrl(link),
      creator: normalizeText(valueOf(item["dc:creator"] ?? item.creator)),
      pubDate: pubDate && !Number.isNaN(pubDate.getTime()) ? pubDate : null,
      pubDateRaw,
      attachments: Array.isArray(item.name)
        ? item.name.map((name) => valueOf(name).trim()).filter(Boolean)
        : valueOf(item.name).trim()
          ? [valueOf(item.name).trim()]
          : [],
    };
  });

  return {
    sourceUrl,
    title: normalizeText(valueOf(parsed?.rss?.channel?.title)),
    lastBuildDate: valueOf(parsed?.rss?.channel?.lastBuildDate).trim(),
    items: items.filter((item) => item.title || item.link),
  };
}

export async function fetchRss(sourceUrl, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(sourceUrl, {
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "user-agent": "school-anouncement-notifier/1.0 (+GitHub Actions)",
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`RSS HTTP ${response.status}`);
    }
    const result = parseRssXml(body, sourceUrl);
    return {
      success: true,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      bytes: Buffer.byteLength(body, "utf8"),
      ...result,
    };
  } finally {
    clearTimeout(timer);
  }
}
