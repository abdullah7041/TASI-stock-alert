import { parseObservationalPulse } from "@/app/lib/observational-pulse-core.mjs";
import { ObservationalPulseStore } from "@/app/lib/observational-pulse-store";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Market-pulse ingestion is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const pulse = parseObservationalPulse(await request.json());
    await new ObservationalPulseStore(env.DB).save(pulse);
    return Response.json({ ok: true, status: pulse.status, observedAt: "observedAt" in pulse ? pulse.observedAt : null });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid market pulse." }, { status: 400 }); }
}
