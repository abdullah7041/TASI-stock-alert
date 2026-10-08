import { PortfolioStore } from "@/app/lib/portfolio-store";

// Read by the producer workflow, not by a browser, so it authenticates with the
// ingest token exactly like /api/top10/current and deliberately does NOT use
// getPrivateResearchContext -- a GitHub runner has no owner session. Without
// this route the workflow's portfolio read 404s every run and main.py silently
// falls back to config.HOLDINGS, which is the whole ledger feature not running.
export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Portfolio storage is unavailable." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const store = new PortfolioStore(env.DB);
    const ownerId = await store.soleOwnerId();
    const book = ownerId ? await store.book(ownerId) : (await import('@/app/lib/portfolio-core.mjs')).buildPortfolioBook([],[]);
    return Response.json({schemaVersion:2,book,eventCount:book.accounts.reduce((n,a)=>n+a.revision,0)}, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Portfolio is unavailable." }, { status: 502 });
  }
}
