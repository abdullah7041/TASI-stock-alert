import type { D1Database } from "cloudflare:workers";
import { researchSchemaStatements } from "@/db/schema";
import { validateEvidenceRecord } from "@/app/lib/evidence-review-core.mjs";

type QueueItem = { title: string; url: string; retrieved_at: string };

export class EvidenceStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ensureReady() { this.#ready ??= this.db.batch(researchSchemaStatements.map((sql) => this.db.prepare(sql))).then(() => undefined); return this.#ready; }
  async saveQueue(items: QueueItem[], collectedAt: string) {
    await this.ensureReady();
    if (!items.length) return;
    await this.db.batch(items.map((item) => this.db.prepare("INSERT INTO evidence_queue (source_url,announcement_json,collected_at) VALUES (?,?,?) ON CONFLICT(source_url) DO UPDATE SET announcement_json=excluded.announcement_json,collected_at=excluded.collected_at")
      .bind(item.url, JSON.stringify(item), collectedAt)));
  }
  async queue() {
    await this.ensureReady();
    const rows = await this.db.prepare("SELECT announcement_json FROM evidence_queue ORDER BY collected_at DESC, source_url ASC").all<{ announcement_json: string }>();
    return rows.results.map((row) => JSON.parse(row.announcement_json));
  }
  async saveReviewed(record: ReturnType<typeof validateEvidenceRecord>, ownerId: string) {
    await this.ensureReady();
    const revisionId = crypto.randomUUID();
    const reviewedAt = new Date().toISOString();
    await this.db.prepare("INSERT INTO evidence_records (revision_id,owner_id,symbol,report_period,evidence_json,reviewed_at) VALUES (?,?,?,?,?,?)")
      .bind(revisionId, ownerId, record.symbol, record.reportPeriod, JSON.stringify(record), reviewedAt).run();
    return { revisionId, reviewedAt, record };
  }
  async current() {
    await this.ensureReady();
    const rows = await this.db.prepare("SELECT evidence_json,symbol FROM evidence_records ORDER BY reviewed_at DESC, revision_id DESC").all<{ evidence_json: string; symbol: string }>();
    const latest = new Map<string, unknown>();
    for (const row of rows.results) if (!latest.has(row.symbol)) latest.set(row.symbol, JSON.parse(row.evidence_json));
    return [...latest.values()];
  }
}
