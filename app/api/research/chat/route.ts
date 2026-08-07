import { dashboardFixture } from "@/app/fixtures/dashboard";
import { answerStockQuestion, getPrivateResearchContext } from "@/app/lib/research-agent";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol?: string; text?: string; manualPrice?: number };
    const candidate = dashboardFixture.qualified.find((item) => item.code === body.symbol);
    if (!candidate || !body.text?.trim()) return Response.json({ error: "A qualified symbol and question are required." }, { status: 400 });
    const message = await answerStockQuestion(await getPrivateResearchContext(request), candidate, body.text.trim(), body.manualPrice);
    return Response.json(message);
  } catch (error) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "Chat failed." }, { status: 502 });
  }
}
