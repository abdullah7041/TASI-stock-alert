import { loadCurrentResearchCandidate } from "@/app/lib/dashboard-access";
import { answerStockQuestion, getPrivateResearchContext } from "@/app/lib/research-agent";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol?: string; text?: string; manualPrice?: number };
    if (!body.text?.trim()) return Response.json({ error: "A qualified symbol and question are required." }, { status: 400 });
    const context = await getPrivateResearchContext(request);
    const { candidate } = await loadCurrentResearchCandidate(body.symbol ?? "");
    const message = await answerStockQuestion(context, candidate, body.text.trim(), body.manualPrice);
    return Response.json(message);
  } catch (error) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "Chat failed." }, { status: 502 });
  }
}
