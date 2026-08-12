import { getPrivateResearchContext } from "@/app/lib/research-agent";
import { PortfolioStore } from "@/app/lib/portfolio-store";

export async function GET(request: Request) {
  try { const context = await getPrivateResearchContext(request); const { env } = await import("cloudflare:workers"); if (!env.DB) throw new Response("Portfolio storage is unavailable.", { status: 503 }); return Response.json(await new PortfolioStore(env.DB).view(context.ownerId)); }
  catch (error) { if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status }); return Response.json({ error: "Portfolio is unavailable." }, { status: 502 }); }
}
