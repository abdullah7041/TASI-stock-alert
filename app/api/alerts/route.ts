import { AlertStore } from "@/app/lib/alert-store";
import { normalizeAlert } from "@/app/lib/alert-names.mjs";
export async function GET(request:Request) { const {env}=await import("cloudflare:workers"); if(!env.DB)return Response.json({error:"Alert storage is unavailable."},{status:503}); const limit=Number(new URL(request.url).searchParams.get("limit") ?? 20); return Response.json({alerts:(await new AlertStore(env.DB).latest(limit)).map(normalizeAlert)}); }
