import { DashboardStore } from "@/app/lib/dashboard-store";
import { AlertStore } from "@/app/lib/alert-store";
import { dashboardFreshness } from "@/app/lib/dashboard-core.mjs";

export async function GET() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) return Response.json({ error: "Dashboard storage is unavailable." }, { status: 503 });
  const [snapshot, alerts] = await Promise.all([
    new DashboardStore(env.DB).latest(),
    new AlertStore(env.DB).latest(20),
  ]);
  if (!snapshot) return Response.json({ error: "No daily digest has been saved yet." }, { status: 404 });
  return Response.json({ snapshot, freshness: dashboardFreshness(snapshot), alerts }, { headers: { "Cache-Control": "no-store" } });
}
