import test from "node:test";
import assert from "node:assert/strict";
import { parseRssXml } from "../src/rss.js";

test("parseRssXml parses CDATA title, body, link and pubDate", () => {
  const xml = `<?xml version="1.0"?><rss><channel><title><![CDATA[古亭公告]]></title><item><title><![CDATA[五年級活動]]></title><description><![CDATA[<p>請於 2026/08/22 報名</p>]]></description><link>https://example.test/freeze/abc12345678901234567890</link><guid>abc12345678901234567890</guid><pubDate>Fri, 21 Aug 2026 00:30:00 GMT</pubDate><name>簡章.pdf</name></item></channel></rss>`;
  const result = parseRssXml(xml, "https://example.test/feed");
  assert.equal(result.title, "古亭公告");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, "五年級活動");
  assert.match(result.items[0].description, /2026\/08\/22 報名/);
  assert.equal(result.items[0].guid, "abc12345678901234567890");
  assert.deepEqual(result.items[0].attachments, ["簡章.pdf"]);
  assert.ok(result.items[0].pubDate instanceof Date);
});
