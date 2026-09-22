import { EvidenceStore } from "@/app/lib/evidence-store";
import { getPrivateOwnerContext } from "@/app/lib/research-agent";

export async function GET(request: Request) {
  try { const owner = await getPrivateOwnerContext(request); return Response.json({ announcements: await new EvidenceStore(owner.db).queue() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status }); return Response.json({ error: "Evidence queue is unavailable." }, { status: 500 }); }
}
