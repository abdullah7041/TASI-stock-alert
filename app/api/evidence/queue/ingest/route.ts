import { EvidenceStore, validateCollectionReceipt } from "@/app/lib/evidence-store";
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
      if (!Number.isFinite(Date.parse(String(value.retrieved_at)))) throw new Error("Announcement retrieval time is invalid.");
      const fields = item as Record<string, unknown>;
      if (fields.symbol != null && (typeof fields.symbol !== "string" || !/^\d{4,5}$/.test(fields.symbol))) throw new Error("Announcement symbol is invalid.");
      for (const key of ["published_at", "source_published_at"]) if (fields[key] != null && typeof fields[key] !== "string") throw new Error("Announcement publication time is invalid.");
      if (fields.published_at && !Number.isFinite(Date.parse(String(fields.published_at)))) throw new Error("Announcement publication time is invalid.");
      if (!isAllowedOfficialUrl(value.url, issuerHosts)) throw new Error("Announcement must use an allowed official source.");
      return value as { title: string; url: string; retrieved_at: string };
    });
    const store = new EvidenceStore(env.DB);
    if (body.receipt !== undefined) await store.saveCollection(validateCollectionReceipt(body.receipt, entries.length), entries);
    else await store.saveQueue(entries, body.retrievedAt);
    return Response.json({ ok: true, count: entries.length });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid evidence queue." }, { status: 400 }); }
}
