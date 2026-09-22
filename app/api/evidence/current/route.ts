import { EvidenceStore } from "@/app/lib/evidence-store";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Evidence storage is unavailable." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  return Response.json({ records: await new EvidenceStore(env.DB).current() }, { headers: { "Cache-Control": "no-store" } });
}
