import { ObservationalPulseStore } from "@/app/lib/observational-pulse-store";
import { getPrivateOwnerContext } from "@/app/lib/research-agent";

export async function GET(request: Request) {
  try { const owner = await getPrivateOwnerContext(request); return Response.json({ pulse: await new ObservationalPulseStore(owner.db).latest() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status }); return Response.json({ error: "Market pulse is unavailable." }, { status: 500 }); }
}
