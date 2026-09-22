import { EvidenceStore } from "@/app/lib/evidence-store";
import { isAllowedOfficialUrl } from "@/app/lib/evidence-review-core.mjs";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Evidence ingestion is not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await request.json();
    if (!Array.isArray(body.announcements) || typeof body.retrievedAt !== "string") throw new Error("A dated announcement queue is required.");
    const issuerHosts = (env.EVIDENCE_OFFICIAL_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean);
    const entries = body.announcements.map((item: unknown) => {
      if (!item || typeof item !== "object") throw new Error("Announcement is invalid.");
      const value = item as { title?: unknown; url?: unknown; retrieved_at?: unknown };
      if (![value.title, value.url, value.retrieved_at].every((field) => typeof field === "string" && field)) throw new Error("Announcement is incomplete.");
      if (!isAllowedOfficialUrl(value.url, issuerHosts)) throw new Error("Announcement must use an allowed official source.");
      return value as { title: string; url: string; retrieved_at: string };
    });
    await new EvidenceStore(env.DB).saveQueue(entries, body.retrievedAt);
    return Response.json({ ok: true, count: entries.length });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid evidence queue." }, { status: 400 }); }
}
