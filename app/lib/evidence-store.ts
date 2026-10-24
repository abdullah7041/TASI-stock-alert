import type { D1Database } from "cloudflare:workers";
import { researchSchemaStatements } from "@/db/schema";
import { validateEvidenceRecord } from "@/app/lib/evidence-review-core.mjs";

export type CollectionReceipt = { runId: string; attemptedAt: string; status: "content" | "empty" | "failed"; count: number; error?: string };
export type QueueItem = { title: string; url: string; retrieved_at: string; symbol?: string | null; published_at?: string | null; source_published_at?: string | null };

export function validateCollectionReceipt(value: unknown, count: number): CollectionReceipt {
  if (!value || typeof value !== "object") throw new Error("Collection receipt is required.");
  const r = value as CollectionReceipt;
  if (typeof r.runId !== "string" || !r.runId.trim() || r.runId.length > 200 || typeof r.attemptedAt !== "string" || !Number.isFinite(Date.parse(r.attemptedAt)) || !["content", "empty", "failed"].includes(r.status) || !Number.isSafeInteger(r.count) || r.count < 0) throw new Error("Collection receipt is invalid.");
  if (r.status === "content" ? r.count !== count || count === 0 : r.count !== 0 || count !== 0) throw new Error("Collection status and count disagree.");
  if (r.error !== undefined && (typeof r.error !== "string" || !r.error.trim() || r.error.length > 500)) throw new Error("Collection error is invalid.");
  return { runId:r.runId, attemptedAt:r.attemptedAt, status:r.status, count:r.count, ...(r.error ? {error:r.error} : {}) };
}

export class EvidenceStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ensureReady() { this.#ready ??= this.db.batch(researchSchemaStatements.map((sql) => this.db.prepare(sql))).then(() => undefined); return this.#ready; }
  #queueStatement(item: QueueItem, collectedAt: string, runId?: string) {
    // The receipt is inserted last in the same D1 batch: a replay cannot change
    // its queue, and a late run cannot replace a newer correction at the URL.
    return this.db.prepare(`INSERT INTO evidence_queue (source_url,announcement_json,collected_at)
      SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM evidence_collections WHERE run_id=?)
      ON CONFLICT(source_url) DO UPDATE SET announcement_json=excluded.announcement_json,collected_at=excluded.collected_at
      WHERE julianday(excluded.collected_at) > julianday(evidence_queue.collected_at)`)
      .bind(item.url, JSON.stringify(item), new Date(collectedAt).toISOString(), runId ?? null);
  }
  async saveQueue(items: QueueItem[], collectedAt: string) {
    await this.ensureReady();
    if (!items.length) return;
    await this.db.batch(items.map((item) => this.#queueStatement(item, collectedAt)));
  }
  async saveCollection(receipt: CollectionReceipt, items: QueueItem[]) {
    const checked = validateCollectionReceipt(receipt, items.length);
    await this.ensureReady();
    const statements = checked.status === "failed" ? [] : items.map((item) => this.#queueStatement(item, checked.attemptedAt, checked.runId));
    statements.push(this.db.prepare("INSERT INTO evidence_collections (run_id,attempted_at,receipt_json) VALUES (?,?,?) ON CONFLICT(run_id) DO NOTHING").bind(checked.runId, new Date(checked.attemptedAt).toISOString(), JSON.stringify(checked)));
    await this.db.batch(statements);
  }
  async latestCollection(): Promise<CollectionReceipt | null> {
    await this.ensureReady();
    const row = await this.db.prepare("SELECT receipt_json FROM evidence_collections ORDER BY julianday(attempted_at) DESC, rowid DESC LIMIT 1").first<{receipt_json:string}>();
    return row ? JSON.parse(row.receipt_json) : null;
  }
  async queue() {
    await this.ensureReady();
    const rows = await this.db.prepare("SELECT announcement_json FROM evidence_queue ORDER BY julianday(collected_at) DESC, source_url ASC").all<{ announcement_json: string }>();
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
  async currentWithRevisions(ownerId?: string) {
    await this.ensureReady();
    const query = this.db.prepare(`SELECT evidence_json,symbol,revision_id,reviewed_at FROM evidence_records${ownerId === undefined ? "" : " WHERE owner_id = ?"} ORDER BY reviewed_at DESC, revision_id DESC`);
    const rows = await (ownerId === undefined ? query : query.bind(ownerId)).all<{ evidence_json:string; symbol:string; revision_id:string; reviewed_at:string }>();
    const latest = new Map<string, {revisionId:string;reviewedAt:string;record:ReturnType<typeof validateEvidenceRecord>}>();
    for (const row of rows.results) if (!latest.has(row.symbol)) latest.set(row.symbol, {revisionId:row.revision_id,reviewedAt:row.reviewed_at,record:JSON.parse(row.evidence_json)});
    return [...latest.values()];
  }
  async current(ownerId?: string) { return (await this.currentWithRevisions(ownerId)).map((revision) => revision.record); }
}
