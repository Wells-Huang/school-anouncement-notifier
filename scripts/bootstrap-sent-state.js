import { join } from "node:path";
import { loadSentState, saveSentState } from "../src/sent-state.js";

const root = process.cwd();
const statePath = join(root, "state", "sent-announcements.json");
const logsDirectory = join(root, "logs");
const loaded = await loadSentState({ statePath, logsDirectory });

if (!loaded.safeToSend) {
  const reasons = [loaded.readError, ...loaded.history.errors.map((item) => `${item.file}: ${item.reason}`)]
    .filter(Boolean)
    .join("; ");
  throw new Error(`無法安全建立已寄送狀態：${reasons}`);
}

await saveSentState(statePath, loaded.state);
console.log(JSON.stringify({
  statePath,
  loadedFromFile: loaded.loadedFromFile,
  historicalLogsRead: loaded.history.filesRead,
  successfulLogs: loaded.history.successfulLogs,
  importedVersions: loaded.history.imported,
  totalVersions: Object.keys(loaded.state.sentVersions).length,
}, null, 2));
