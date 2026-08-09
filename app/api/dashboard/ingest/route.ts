import { parseDashboardSnapshot } from "@/app/lib/dashboard-core.mjs";
import { DashboardStore } from "@/app/lib/dashboard-store";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Dashboard ingestion is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const snapshot = parseDashboardSnapshot(await request.json());
    await new DashboardStore(env.DB).save(snapshot);
    return Response.json({ ok: true, asOf: snapshot.asOf });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid dashboard snapshot." }, { status: 400 });
  }
}
