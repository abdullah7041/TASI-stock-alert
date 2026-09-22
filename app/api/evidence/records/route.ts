import { validateEvidenceRecord } from "@/app/lib/evidence-review-core.mjs";
import { EvidenceStore } from "@/app/lib/evidence-store";
import { getPrivateOwnerContext } from "@/app/lib/research-agent";

function issuerHosts(value: string | undefined) { return (value ?? "").split(",").map((host) => host.trim()).filter(Boolean); }

export async function POST(request: Request) {
  try {
    const owner = await getPrivateOwnerContext(request);
    const { env } = await import("cloudflare:workers");
    const record = validateEvidenceRecord(await request.json(), issuerHosts(env.EVIDENCE_OFFICIAL_HOSTS));
    return Response.json(await new EvidenceStore(owner.db).saveReviewed(record, owner.ownerId), { status: 201 });
  } catch (error) { if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status }); return Response.json({ error: error instanceof Error ? error.message : "Invalid evidence record." }, { status: 400 }); }
}
