import { loadCurrentResearchCandidate } from "@/app/lib/dashboard-access";
import { createOrReuseReport, getPrivateResearchContext } from "@/app/lib/research-agent";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol?: string };
    const context = await getPrivateResearchContext(request);
    const { candidate, snapshot } = await loadCurrentResearchCandidate(body.symbol ?? "");
    const result = await createOrReuseReport(context, candidate, snapshot);
    return Response.json(result);
  } catch (error) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "Research failed." }, { status: 502 });
  }
}
