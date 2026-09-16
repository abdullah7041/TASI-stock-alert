import { DashboardStore } from "@/app/lib/dashboard-store";
import { AlertStore } from "@/app/lib/alert-store";
import { dashboardFreshness } from "@/app/lib/dashboard-core.mjs";
import { normalizeAlert } from "@/app/lib/alert-names.mjs";
import { DeliveryStore } from "@/app/lib/delivery-store";
import { MarketPulseStore } from "@/app/lib/market-pulse-store";

export async function GET() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) return Response.json({ error: "Dashboard storage is unavailable." }, { status: 503 });
  const [snapshot, alerts, marketPulse] = await Promise.all([
    new DashboardStore(env.DB).latest(),
    new AlertStore(env.DB).latest(20),
    new MarketPulseStore(env.DB).latest(),
  ]);
  if (!snapshot) return Response.json({ error: "No daily digest has been saved yet." }, { status: 404 });
  const canonical = snapshot as unknown as { schemaVersion: number; artifactId?: string };
  const stored = canonical.schemaVersion === 3 && canonical.artifactId ? await new DeliveryStore(env.DB).forArtifact(canonical.artifactId) : {};
  const delivery = {
    producer: { status: "confirmed" as const, attemptedAt: snapshot.asOf },
    discord: stored.discord ?? { status: "unknown" as const },
    cockpit: stored.cockpit ?? { status: "unknown" as const },
  };
  return Response.json({ snapshot, freshness: dashboardFreshness(snapshot), alerts: alerts.map(normalizeAlert), marketPulse, delivery }, { headers: { "Cache-Control": "no-store" } });
}
