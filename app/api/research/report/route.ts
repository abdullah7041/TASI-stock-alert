import { dashboardFixture } from "@/app/fixtures/dashboard";
import { createOrReuseReport, getPrivateResearchContext } from "@/app/lib/research-agent";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { symbol?: string };
    const candidate = dashboardFixture.qualified.find((item) => item.code === body.symbol);
    if (!candidate) return Response.json({ error: "This symbol is not available for research." }, { status: 403 });
    const result = await createOrReuseReport(await getPrivateResearchContext(request), candidate, dashboardFixture);
    return Response.json(result);
  } catch (error) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status });
    return Response.json({ error: error instanceof Error ? error.message : "Research failed." }, { status: 502 });
  }
}
