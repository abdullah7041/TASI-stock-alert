import { dashboardFreshness } from "@/app/lib/dashboard-core.mjs";
import { DashboardStore } from "@/app/lib/dashboard-store";
import { currentQualifiedCandidate } from "@/app/lib/research-core.mjs";

export async function loadCurrentResearchCandidate(symbol: string) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Response("The daily dashboard is unavailable.", { status: 503 });
  const snapshot = await new DashboardStore(env.DB).latest();
  if (!snapshot) throw new Response("No verified daily snapshot is available.", { status: 409 });
  const freshness = dashboardFreshness(snapshot);
  try {
    return { snapshot, candidate: currentQualifiedCandidate(snapshot, symbol, freshness) };
  } catch (error) {
    throw new Response(error instanceof Error ? error.message : "This symbol is not available for research.", {
      status: freshness === "stale" ? 409 : 403,
    });
  }
}
