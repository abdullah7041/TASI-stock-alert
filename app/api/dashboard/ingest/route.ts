import { parseDashboardSnapshot } from "@/app/lib/dashboard-core.mjs";
import { DashboardStore } from "@/app/lib/dashboard-store";
import { AlertStore } from "@/app/lib/alert-store";
import { Top10Store } from "@/app/lib/top10-store";
import { DeliveryStore } from "@/app/lib/delivery-store";
import { dashboardIngestProjection } from "@/app/lib/dashboard-ingest-mode.mjs";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Dashboard ingestion is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const snapshot = parseDashboardSnapshot(await request.json());
    const replayOnly = request.headers.get("x-tasi-replay-only") === "true";
    await new DashboardStore(env.DB).save(snapshot);
    const canonical = snapshot as unknown as { schemaVersion: number; artifactId: string; top10: unknown; top10Review?: unknown; tradeDate: string; alerts: never[] };
    const projection = dashboardIngestProjection(canonical, replayOnly);
    const top10Store = new Top10Store(env.DB);
    for (const draft of projection.top10Drafts) await top10Store.saveDraft(draft as never, canonical.tradeDate);
    await new AlertStore(env.DB).appendMany(projection.alerts as never[]);
    if (canonical.schemaVersion === 3) {
      await new DeliveryStore(env.DB).record({ artifactId: canonical.artifactId, destination: "cockpit", status: "success", attemptedAt: new Date().toISOString() });
    }
    return Response.json({ ok: true, asOf: snapshot.asOf, ...(canonical.schemaVersion === 3 ? { artifactId: canonical.artifactId } : {}) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid dashboard snapshot." }, { status: 400 });
  }
}
