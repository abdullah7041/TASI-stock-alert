import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function deliveryGuardSatisfied(payload, expectedTradeDate) {
  const snapshot = payload?.snapshot;
  const delivery = payload?.delivery;
  if (!snapshot || snapshot.schemaVersion !== 3 || snapshot.artifactKind !== "digest") return false;
  if (snapshot.tradeDate !== expectedTradeDate || typeof snapshot.artifactId !== "string") return false;
  const confirmed = (value) => ["success", "confirmed"].includes(value?.status);
  return confirmed(delivery?.cockpit) && confirmed(delivery?.discord);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , payloadPath, expectedTradeDate] = process.argv;
  let payload = null;
  try { payload = JSON.parse(readFileSync(payloadPath, "utf8")); } catch {}
  process.stdout.write(deliveryGuardSatisfied(payload, expectedTradeDate) ? "true" : "false");
}
