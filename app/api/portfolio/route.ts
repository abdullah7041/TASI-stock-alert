import { getOwnerContext } from "@/app/lib/owner-context";
import { PortfolioStore } from "@/app/lib/portfolio-store";
import {PortfolioConflict} from '@/app/lib/portfolio-core.mjs';

export async function GET(request: Request) {
  try { const context = await getOwnerContext(request); const { env } = await import("cloudflare:workers"); if (!env.DB) throw new Response("Portfolio storage is unavailable.", { status: 503 }); return Response.json(await new PortfolioStore(env.DB).saved(context.ownerId), {headers:{'Cache-Control':'no-store'}}); }
  catch (error) { if (error instanceof Response) return Response.json({ error: await error.text() }, { status: error.status }); if(error instanceof PortfolioConflict)return Response.json({error:error.message},{status:409});return Response.json({ error: "Portfolio is unavailable." }, { status: 502 }); }
}
