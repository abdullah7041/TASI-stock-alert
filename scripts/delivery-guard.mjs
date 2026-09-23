import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function deliveryGuardState(payload, expectedTradeDate) {
  const snapshot = payload?.snapshot;
  const delivery = payload?.delivery;
  if (!snapshot || !delivery || snapshot.schemaVersion !== 3 || snapshot.artifactKind !== "digest") return "unknown";
  if (snapshot.tradeDate !== expectedTradeDate) return "not-delivered";
  if (typeof snapshot.artifactId !== "string") return "unknown";
  const confirmed = (value) => ["success", "confirmed"].includes(value?.status);
  return confirmed(delivery.cockpit) && confirmed(delivery.discord) ? "delivered" : "not-delivered";
}

export function deliveryGuardSatisfied(payload, expectedTradeDate) {
  return deliveryGuardState(payload, expectedTradeDate) === "delivered";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , payloadPath, expectedTradeDate] = process.argv;
  let payload = null;
  try { payload = JSON.parse(readFileSync(payloadPath, "utf8")); } catch {}
  process.stdout.write(deliveryGuardState(payload, expectedTradeDate));
}
