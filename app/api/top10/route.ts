import { Top10Store } from "@/app/lib/top10-store";
export async function GET() { const { env } = await import("cloudflare:workers"); if (!env.DB) return Response.json({error:"Top 10 storage is unavailable."},{status:503}); return Response.json(await new Top10Store(env.DB).current()); }
