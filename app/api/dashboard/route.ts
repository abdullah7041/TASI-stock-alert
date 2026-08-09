import { DashboardStore } from "@/app/lib/dashboard-store";

export async function GET() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) return Response.json({ error: "Dashboard storage is unavailable." }, { status: 503 });
  const snapshot = await new DashboardStore(env.DB).latest();
  if (!snapshot) return Response.json({ error: "No daily digest has been saved yet." }, { status: 404 });
  return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
