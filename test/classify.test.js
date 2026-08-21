import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, classifyNotice, getRecentState } from "../src/classify.js";
import { buildEmailSubject } from "../src/email.js";

const now = new Date("2026-08-21T08:00:00+08:00");

test("classifies a fifth-grade competition as participation", () => {
  const item = classifyNotice({
    title: "國小四至六年級學生科學比賽報名",
    category: "活動/競賽",
    listDate: "2026/08/21",
    body: "適合國小四至六年級學生參加，報名截止 2026/08/30。",
  }, now);
  assert.equal(item.relevant, true);
  assert.equal(item.bucket, "今天必看");
  assert.equal(item.priority, "高");
  assert.equal(item.deadline, "2026/08/30");
});

test("classifies a parent-facing health notice as must-read", () => {
  const item = classifyNotice({
    title: "學生健康檢查及家長注意事項",
    category: "校務公告",
    listDate: "2026/08/21",
    body: "請家長於 2026/08/25 前完成回覆表單。",
  }, now);
  assert.equal(item.relevant, true);
  assert.equal(item.bucket, "今天必看");
  assert.equal(item.deadline, "2026/08/25");
});

test("uses the registration closing date instead of a later event date", () => {
  const item = classifyNotice({
    title: "國際運算思維挑戰賽",
    category: "活動/競賽",
    listDate: "2026/08/20",
    body: "報名期間：115年9月21日至10月22日止。正式挑戰賽：115年11月9日至11月20日止。",
  }, now);
  assert.equal(item.deadline, "2026/10/22");
});

test("recognizes a deadline followed by a weekday parenthesis", () => {
  const item = classifyNotice({
    title: "AI 無人機學生體驗活動",
    category: "研習進修",
    listDate: "2026/08/20",
    body: "報名方式：即日起至115年8月24日（星期一）止，免報名費。活動日期：115年8月27日。",
  }, now);
  assert.equal(item.deadline, "2026/08/24");
});

test("does not select a teacher-only training notice", () => {
  const item = classifyNotice({
    title: "教師研習進修課程報名",
    category: "研習進修",
    listDate: "2026/08/21",
    body: "限本校教師參加。",
  }, now);
  assert.equal(item.relevant, false);
});

test("does not select a teacher workshop merely because it mentions elementary schools", () => {
  const item = classifyNotice({
    title: "教師資訊科技素養導向線上工作坊",
    category: "研習進修",
    listDate: "2026/08/21",
    body: "參加對象為各縣市有興趣國小教師，請教師報名。",
  }, now);
  assert.equal(item.relevant, false);
});

test("does not select a first-grade-only new-student notice for a fifth-grade child", () => {
  const item = classifyNotice({
    title: "一年級新生午餐報名",
    category: "校務公告",
    listDate: "2026/08/21",
    body: "請一年級新生家長填寫用餐意願。",
  }, now);
  assert.equal(item.relevant, false);
});

test("expired activity is excluded", () => {
  const item = classifyNotice({
    title: "親子營隊報名",
    category: "活動/競賽",
    listDate: "2026/08/21",
    body: "報名截止 2026/08/20。",
  }, now);
  assert.equal(item.relevant, false);
  assert.equal(item.expired, true);
});

test("RSS timestamp is authoritative for the recent-window check", () => {
  const fresh = getRecentState({
    listDate: "2026/08/20",
    rss: { pubDate: new Date("2026-08-21T00:30:00+08:00") },
  }, now, 24);
  assert.equal(fresh.recent, true);
  assert.equal(fresh.precision, "timestamp");
});

test("report counts recent, relevant and skipped notices", () => {
  const report = buildReport([
    { title: "五年級閱讀活動", category: "活動/競賽", listDate: "2026/08/21", body: "學生可參加。" },
    { title: "教師研習", category: "研習進修", listDate: "2026/08/21", body: "限教師。" },
    { title: "舊公告", category: "校務公告", listDate: "2026/08/01", body: "過期。" },
  ], now, 24);
  assert.equal(report.counts.recent24h, 2);
  assert.equal(report.counts.relevant, 1);
  assert.equal(report.counts.skipped, 1);
  assert.equal(buildEmailSubject("2026-08-21", report), "【古亭國小公告摘要】2026/08/21｜必看 0 則、可參加 1 則");
});
