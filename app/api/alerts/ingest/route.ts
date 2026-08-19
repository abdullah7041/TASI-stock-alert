import { AlertStore } from "@/app/lib/alert-store";
import type { MovementAlert } from "@/app/lib/evidence-types";

function parseAlerts(value: unknown): MovementAlert[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Alert payload must be an object.");
  const alerts = (value as { alerts?: unknown }).alerts;
  if (!Array.isArray(alerts)) throw new Error("alerts must be an array.");
  return alerts.map((alert) => {
    if (!alert || typeof alert !== "object" || Array.isArray(alert)) throw new Error("Each alert must be an object.");
    const item = alert as Record<string, unknown>;
    // A newly ingested alert must name its company. Legacy rows already in D1
    // stay readable because the read paths normalize; nothing unnamed is added.
    if (typeof item.name !== "string" || !item.name.trim()) throw new Error("Each alert must name its company.");
    if (typeof item.alertId !== "string" || typeof item.code !== "string" || !["upside", "downside"].includes(String(item.direction)) || typeof item.observedAt !== "string" || typeof item.receivedAt !== "string" || item.latency !== "delayed-intraday" || !Number.isFinite(item.excessMovePct) || !Number.isFinite(item.robustZ) || typeof item.reason !== "string") throw new Error("Invalid delayed movement alert.");
    if (Number.isNaN(Date.parse(item.observedAt)) || Number.isNaN(Date.parse(item.receivedAt))) throw new Error("Alert timestamps must be valid.");
    return { alertId: item.alertId, code: item.code, name: item.name.trim(), direction: item.direction as MovementAlert["direction"], observedAt: item.observedAt, receivedAt: item.receivedAt, latency: "delayed-intraday", excessMovePct: Number(item.excessMovePct), robustZ: Number(item.robustZ), ...(Number.isFinite(item.volumeRatio) ? { volumeRatio: Number(item.volumeRatio) } : {}), reason: item.reason };
  });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Alert ingestion is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const alerts = parseAlerts(await request.json());
    await new AlertStore(env.DB).appendMany(alerts);
    return Response.json({ ok: true, accepted: alerts.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid alert payload." }, { status: 400 });
  }
}
