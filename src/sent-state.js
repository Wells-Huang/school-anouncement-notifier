import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { normalizeText } from "./text.js";

export const SENT_STATE_VERSION = 1;

export function createEmptySentState() {
  return {
    version: SENT_STATE_VERSION,
    updatedAt: "",
    sentVersions: {},
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function canonicalizeAnnouncementUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return raw.split(/[?#]/u)[0];
  }
}

function fallbackIdentity(notice) {
  return sha256(JSON.stringify([
    normalizeText(notice.title || ""),
    normalizeText(notice.category || ""),
    normalizeText(notice.publishedDate || ""),
  ]));
}

function undatedContentVersion(notice) {
  return sha256(JSON.stringify([
    normalizeText(notice.title || ""),
    normalizeText(notice.category || ""),
    normalizeText(notice.summary || ""),
    normalizeText(notice.deadline || ""),
  ]));
}

export function announcementVersion(notice) {
  const canonicalUrl = canonicalizeAnnouncementUrl(notice.originalUrl);
  const stableIdentity = canonicalUrl
    ? `url:${canonicalUrl}`
    : `fallback:${fallbackIdentity(notice)}`;
  const updatedDate = normalizeText(notice.updatedDate || notice.publishedDate || "");
  const versionMarker = updatedDate
    ? `date:${updatedDate}`
    : `content:${undatedContentVersion(notice)}`;

  return {
    key: sha256(`${stableIdentity}|${versionMarker}`),
    stableIdentity,
    identityType: canonicalUrl ? "originalUrl" : "fallback",
    canonicalUrl,
    updatedDate,
  };
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("已寄送狀態不是有效的 JSON 物件");
  }
  if (value.version !== SENT_STATE_VERSION) {
    throw new Error(`不支援的已寄送狀態版本：${value.version ?? "missing"}`);
  }
  if (!value.sentVersions || typeof value.sentVersions !== "object" || Array.isArray(value.sentVersions)) {
    throw new Error("已寄送狀態缺少 sentVersions 物件");
  }
  return {
    version: SENT_STATE_VERSION,
    updatedAt: String(value.updatedAt || ""),
    sentVersions: { ...value.sentVersions },
  };
}

function sentEntry(notice, sentAt, source) {
  const version = announcementVersion(notice);
  return {
    key: version.key,
    value: {
      title: normalizeText(notice.title || ""),
      category: normalizeText(notice.category || ""),
      publishedDate: normalizeText(notice.publishedDate || ""),
      updatedDate: version.updatedDate,
      originalUrl: version.canonicalUrl,
      identityType: version.identityType,
      firstSentAt: String(sentAt || ""),
      lastSentAt: String(sentAt || ""),
      source: String(source || ""),
    },
  };
}

function setHistoricalEntry(state, notice, sentAt, source) {
  const entry = sentEntry(notice, sentAt, source);
  const existing = state.sentVersions[entry.key];
  if (!existing) {
    state.sentVersions[entry.key] = entry.value;
    return true;
  }

  const existingFirst = String(existing.firstSentAt || existing.lastSentAt || "");
  const firstSentAt = [existingFirst, entry.value.firstSentAt].filter(Boolean).sort()[0] || "";
  const lastSentAt = [String(existing.lastSentAt || ""), entry.value.lastSentAt]
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  const next = {
    ...existing,
    firstSentAt,
    lastSentAt,
    source: entry.value.lastSentAt >= String(existing.lastSentAt || "")
      ? entry.value.source
      : existing.source,
  };
  if (JSON.stringify(next) === JSON.stringify(existing)) return false;
  state.sentVersions[entry.key] = next;
  return true;
}

async function listScanLogs(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listScanLogs(fullPath));
    } else if (/^scan-.*\.json$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function importSuccessfulLogs(state, logsDirectory) {
  const files = await listScanLogs(logsDirectory);
  const errors = [];
  let successfulLogs = 0;
  let imported = 0;
  let refreshed = 0;
  let metadataChanged = false;

  for (const file of files) {
    try {
      const log = JSON.parse(await readFile(file, "utf8"));
      if (log.email?.sent !== true) continue;
      successfulLogs += 1;
      const sentAt = log.execution?.completedAtUtc || log.execution?.startedAtUtc || "";
      if (sentAt && sentAt > state.updatedAt) {
        state.updatedAt = sentAt;
        metadataChanged = true;
      }
      for (const notice of log.relevantAnnouncements || []) {
        const version = announcementVersion(notice);
        const existed = Boolean(state.sentVersions[version.key]);
        if (setHistoricalEntry(state, notice, sentAt, `log:${relative(process.cwd(), file)}`)) {
          if (existed) refreshed += 1;
          else imported += 1;
        }
      }
    } catch (error) {
      errors.push({
        file: relative(process.cwd(), file),
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    filesRead: files.length,
    successfulLogs,
    imported,
    refreshed,
    errors,
    changed: imported > 0 || refreshed > 0 || metadataChanged,
  };
}

export async function loadSentState({ statePath, logsDirectory }) {
  let state = createEmptySentState();
  let loadedFromFile = false;
  let readError = "";

  try {
    state = normalizeState(JSON.parse(await readFile(statePath, "utf8")));
    loadedFromFile = true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      readError = error instanceof Error ? error.message : String(error);
    }
  }

  const recordsBeforeImport = Object.keys(state.sentVersions).length;
  const history = await importSuccessfulLogs(state, logsDirectory);
  const recordsAfterImport = Object.keys(state.sentVersions).length;

  return {
    state,
    loadedFromFile,
    readError,
    safeToSend: !readError && history.errors.length === 0,
    dirty: history.changed,
    recordsBeforeImport,
    recordsAfterImport,
    history,
  };
}

export function partitionAnnouncementsBySentState(notices, state) {
  const pending = [];
  const alreadySent = [];
  const sameVersionDuplicates = [];
  const pendingVersions = new Map();

  for (const notice of notices) {
    const version = announcementVersion(notice);
    const previous = state.sentVersions[version.key];
    if (previous) {
      alreadySent.push({ notice, version, previous });
    } else if (pendingVersions.has(version.key)) {
      sameVersionDuplicates.push({
        notice,
        version,
        keptNotice: pendingVersions.get(version.key),
      });
    } else {
      pending.push(notice);
      pendingVersions.set(version.key, notice);
    }
  }

  return { pending, alreadySent, sameVersionDuplicates };
}

export function markSuccessfullySent(state, notices, { emailSent, sentAt = new Date().toISOString() } = {}) {
  if (!emailSent) return { added: 0, total: Object.keys(state.sentVersions).length };

  let added = 0;
  for (const notice of notices) {
    const entry = sentEntry(notice, sentAt, "smtp");
    const existing = state.sentVersions[entry.key];
    if (!existing) added += 1;
    state.sentVersions[entry.key] = existing
      ? { ...entry.value, firstSentAt: existing.firstSentAt || existing.lastSentAt || sentAt }
      : entry.value;
  }
  if (notices.length > 0) state.updatedAt = sentAt;
  return { added, total: Object.keys(state.sentVersions).length };
}

export async function saveSentState(statePath, state) {
  const sentVersions = Object.fromEntries(
    Object.entries(state.sentVersions).sort(([left], [right]) => left.localeCompare(right)),
  );
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify({ ...state, sentVersions }, null, 2)}\n`, "utf8");
  return statePath;
}
