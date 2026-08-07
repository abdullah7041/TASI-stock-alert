import { getBudget, getPrivateResearchContext } from "@/app/lib/research-agent";

export async function GET(request: Request) {
  try {
    return Response.json(await getBudget(await getPrivateResearchContext(request)));
  } catch (error) {
    if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status });
    return Response.json({ error: "Budget is unavailable." }, { status: 502 });
  }
}
