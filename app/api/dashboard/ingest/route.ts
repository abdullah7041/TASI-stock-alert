import { parseDashboardSnapshot } from "@/app/lib/dashboard-core.mjs";
import { DashboardStore } from "@/app/lib/dashboard-store";
import { AlertStore } from "@/app/lib/alert-store";
import { Top10Store } from "@/app/lib/top10-store";
import { DeliveryStore } from "@/app/lib/delivery-store";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Dashboard ingestion is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const snapshot = parseDashboardSnapshot(await request.json());
    await new DashboardStore(env.DB).save(snapshot);
    if (snapshot.schemaVersion === 2) {
      await new Top10Store(env.DB).saveDraft(snapshot.top10, snapshot.tradeDate);
      await new AlertStore(env.DB).appendMany(snapshot.alerts);
    }
    const canonical = snapshot as unknown as { schemaVersion: number; artifactId: string; top10: unknown; tradeDate: string; alerts: never[] };
    if (canonical.schemaVersion === 3) {
      await new Top10Store(env.DB).saveDraft(canonical.top10 as never, canonical.tradeDate);
      await new AlertStore(env.DB).appendMany(canonical.alerts);
      await new DeliveryStore(env.DB).record({ artifactId: canonical.artifactId, destination: "cockpit", status: "success", attemptedAt: new Date().toISOString() });
    }
    return Response.json({ ok: true, asOf: snapshot.asOf, ...(canonical.schemaVersion === 3 ? { artifactId: canonical.artifactId } : {}) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid dashboard snapshot." }, { status: 400 });
  }
}
