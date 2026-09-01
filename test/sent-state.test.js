import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  announcementVersion,
  canonicalizeAnnouncementUrl,
  createEmptySentState,
  loadSentState,
  markSuccessfullySent,
  partitionAnnouncementsBySentState,
  saveSentState,
} from "../src/sent-state.js";

const notice = {
  title: "【轉知】家長接送區公告",
  category: "校務公告",
  publishedDate: "2026/08/31",
  updatedDate: "2026/08/31",
  summary: "請家長留意接送安排。",
  deadline: "無明確截止日期",
  originalUrl: "https://www.gtes.tp.edu.tw/nss/main/freeze/example?vector=private&static=false",
};

test("canonical URL ignores query parameters and hash", () => {
  assert.equal(
    canonicalizeAnnouncementUrl(`${notice.originalUrl}#section`),
    "https://www.gtes.tp.edu.tw/nss/main/freeze/example",
  );
});

test("same URL and update date is suppressed after successful SMTP delivery", () => {
  const state = createEmptySentState();
  const first = partitionAnnouncementsBySentState([notice], state);
  assert.equal(first.pending.length, 1);

  const marked = markSuccessfullySent(state, first.pending, {
    emailSent: true,
    sentAt: "2026-08-31T05:00:00.000Z",
  });
  assert.equal(marked.added, 1);

  const second = partitionAnnouncementsBySentState([
    { ...notice, originalUrl: `${notice.originalUrl}&tracking=next-day` },
  ], state);
  assert.equal(second.pending.length, 0);
  assert.equal(second.alreadySent.length, 1);
});

test("same URL and update date appears only once in the current email batch", () => {
  const state = createEmptySentState();
  const result = partitionAnnouncementsBySentState([
    notice,
    { ...notice, category: "活動/競賽", summary: "同一公告在另一分類的抓取內容。" },
  ], state);

  assert.equal(result.pending.length, 1);
  assert.equal(result.sameVersionDuplicates.length, 1);
});

test("same URL is sent again when updated date changes", () => {
  const state = createEmptySentState();
  markSuccessfullySent(state, [notice], { emailSent: true, sentAt: "2026-08-31T05:00:00.000Z" });

  const result = partitionAnnouncementsBySentState([
    { ...notice, updatedDate: "2026/09/01" },
  ], state);
  assert.equal(result.pending.length, 1);
  assert.notEqual(announcementVersion(notice).key, announcementVersion(result.pending[0]).key);
});

test("failed SMTP delivery does not mark the notice as sent", () => {
  const state = createEmptySentState();
  const marked = markSuccessfullySent(state, [notice], {
    emailSent: false,
    sentAt: "2026-08-31T05:00:00.000Z",
  });
  assert.equal(marked.added, 0);
  assert.equal(partitionAnnouncementsBySentState([notice], state).pending.length, 1);
});

test("successful historical logs rebuild state while failed deliveries are ignored", async () => {
  const root = await mkdtemp(join(tmpdir(), "school-notifier-state-"));
  const logsDirectory = join(root, "logs");
  const statePath = join(root, "state", "sent-announcements.json");
  await mkdir(join(logsDirectory, "2026-08-31"), { recursive: true });
  await writeFile(join(logsDirectory, "2026-08-31", "scan-success.json"), JSON.stringify({
    execution: { completedAtUtc: "2026-08-31T05:00:00.000Z" },
    email: { sent: true },
    relevantAnnouncements: [notice],
  }), "utf8");
  await writeFile(join(logsDirectory, "2026-08-31", "scan-failed.json"), JSON.stringify({
    execution: { completedAtUtc: "2026-08-31T06:00:00.000Z" },
    email: { sent: false },
    relevantAnnouncements: [{ ...notice, updatedDate: "2026/09/01" }],
  }), "utf8");
  await writeFile(join(logsDirectory, "2026-08-31", "scan-success-repeat.json"), JSON.stringify({
    execution: { completedAtUtc: "2026-08-31T07:00:00.000Z" },
    email: { sent: true },
    relevantAnnouncements: [notice],
  }), "utf8");

  const loaded = await loadSentState({ statePath, logsDirectory });
  assert.equal(loaded.safeToSend, true);
  assert.equal(loaded.history.imported, 1);
  assert.equal(partitionAnnouncementsBySentState([notice], loaded.state).alreadySent.length, 1);
  assert.equal(
    partitionAnnouncementsBySentState([{ ...notice, updatedDate: "2026/09/01" }], loaded.state).pending.length,
    1,
  );

  await saveSentState(statePath, loaded.state);
  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(Object.keys(persisted.sentVersions).length, 1);
  assert.equal(persisted.updatedAt, "2026-08-31T07:00:00.000Z");
  const entry = Object.values(persisted.sentVersions)[0];
  assert.equal(entry.firstSentAt, "2026-08-31T05:00:00.000Z");
  assert.equal(entry.lastSentAt, "2026-08-31T07:00:00.000Z");
});
