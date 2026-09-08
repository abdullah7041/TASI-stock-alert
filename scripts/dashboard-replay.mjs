import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function identity(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  if (typeof snapshot.artifactId === "string" && snapshot.artifactId) return snapshot.artifactId;
  if (typeof snapshot.tradeDate !== "string" || typeof snapshot.asOf !== "string") return null;
  return `${snapshot.schemaVersion}:${snapshot.tradeDate}:${snapshot.asOf}`;
}

export function dashboardReplayNeeded({ mode, local, remote }) {
  if (!local || typeof local !== "object") throw new Error("Local dashboard artifact is unavailable.");
  if (mode === "cockpit-refresh") return true;
  const deployed = remote?.snapshot;
  const cockpitReceipt = remote?.delivery?.cockpit?.status;
  return !deployed
    || deployed.tradeDate !== local.tradeDate
    || identity(deployed) !== identity(local)
    || !["success", "confirmed"].includes(cockpitReceipt);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , mode, localPath, remotePath] = process.argv;
  const needed = dashboardReplayNeeded({
    mode,
    local: readJson(localPath),
    remote: readJson(remotePath),
  });
  process.stdout.write(needed ? "true" : "false");
}
