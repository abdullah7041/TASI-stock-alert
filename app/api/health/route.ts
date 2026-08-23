import { DashboardStore } from "@/app/lib/dashboard-store";

export async function GET() {
  const { env } = await import("cloudflare:workers");
  const acceptedSchemaVersions = [1, 2, 3];
  if (!env.DB) {
    return Response.json({ ok: false, deployedCommit: env.DEPLOYED_COMMIT_SHA ?? "unknown", acceptedSchemaVersions, database: "unavailable", latestSnapshot: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const snapshot = await new DashboardStore(env.DB).latest();
    return Response.json({
      ok: true,
      deployedCommit: env.DEPLOYED_COMMIT_SHA ?? "unknown",
      acceptedSchemaVersions,
      database: "ready",
      latestSnapshot: snapshot ? { schemaVersion: snapshot.schemaVersion, asOf: snapshot.asOf, tradeDate: snapshot.tradeDate } : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, deployedCommit: env.DEPLOYED_COMMIT_SHA ?? "unknown", acceptedSchemaVersions, database: "error", latestSnapshot: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
