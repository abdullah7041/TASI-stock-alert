import { parseDeliveryReceipt } from "@/app/lib/delivery-core.mjs";
import { DeliveryStore } from "@/app/lib/delivery-store";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.DB || !env.DASHBOARD_INGEST_TOKEN) return Response.json({ error: "Delivery receipts are not configured." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const receipt = parseDeliveryReceipt(await request.json());
    await new DeliveryStore(env.DB).record(receipt);
    return Response.json({ ok: true, artifactId: receipt.artifactId, destination: receipt.destination });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid delivery receipt." }, { status: 400 });
  }
}
