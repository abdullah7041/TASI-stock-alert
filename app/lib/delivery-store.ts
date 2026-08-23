import type { D1Database } from "cloudflare:workers";
import { researchSchemaStatements } from "@/db/schema";
import { parseDeliveryReceipt } from "./delivery-core.mjs";

type Receipt = ReturnType<typeof parseDeliveryReceipt>;

export class DeliveryStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ensureReady() {
    this.#ready ??= this.db.batch(researchSchemaStatements.map((sql) => this.db.prepare(sql))).then(() => undefined);
    return this.#ready;
  }
  async record(value: Receipt) {
    await this.ensureReady();
    await this.db.prepare(
      "INSERT INTO artifact_deliveries (artifact_id, destination, status, attempted_at, error_detail, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(artifact_id, destination) DO UPDATE SET status = excluded.status, attempted_at = excluded.attempted_at, error_detail = excluded.error_detail, updated_at = excluded.updated_at",
    ).bind(value.artifactId, value.destination, value.status, value.attemptedAt, value.errorDetail ?? null, new Date().toISOString()).run();
  }
  async forArtifact(artifactId: string) {
    await this.ensureReady();
    const rows = await this.db.prepare("SELECT destination, status, attempted_at, error_detail FROM artifact_deliveries WHERE artifact_id = ?").bind(artifactId).all<{ destination: "discord" | "cockpit"; status: "success" | "failure"; attempted_at: string; error_detail: string | null }>();
    return Object.fromEntries(rows.results.map((row) => [row.destination, {
      status: row.status === "success" ? "confirmed" : "failed",
      attemptedAt: row.attempted_at,
      ...(row.error_detail ? { errorDetail: row.error_detail } : {}),
    }]));
  }
}
