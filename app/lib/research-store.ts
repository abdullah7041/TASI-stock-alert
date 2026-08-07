import type { D1Database } from "cloudflare:workers";
import { researchSchemaStatements } from "@/db/schema";
import { AGENT_MONTHLY_STOP_SAR } from "@/app/lib/research-core.mjs";

export type StoredReport = {
  id: string;
  ownerId: string;
  symbol: string;
  tradeDate: string;
  status: "completed" | "failed";
  report: unknown;
};

type ReportRow = { id: string; owner_id: string; symbol: string; trade_date: string; status: "completed" | "failed"; report_json: string };

export class ResearchStore {
  #ready: Promise<void> | undefined;

  constructor(private readonly db: D1Database) {}

  async ensureReady() {
    this.#ready ??= this.db.batch(researchSchemaStatements.map((statement) => this.db.prepare(statement))).then(() => undefined);
    return this.#ready;
  }

  async findReport(ownerId: string, symbol: string, tradeDate: string) {
    await this.ensureReady();
    const row = await this.db.prepare("SELECT id, owner_id, symbol, trade_date, status, report_json FROM agent_reports WHERE owner_id = ? AND symbol = ? AND trade_date = ?").bind(ownerId, symbol, tradeDate).first<ReportRow>();
    return row ? this.toReport(row) : null;
  }

  async reserve(ownerId: string, monthKey: string, operationKey: string, costSar: number) {
    await this.ensureReady();
    const result = await this.db.prepare(
      "INSERT INTO agent_usage (owner_id, month_key, operation_key, cost_sar, created_at) SELECT ?, ?, ?, ?, ? WHERE COALESCE((SELECT SUM(cost_sar) FROM agent_usage WHERE owner_id = ? AND month_key = ?), 0) + ? <= ? ON CONFLICT(owner_id, operation_key) DO NOTHING",
    ).bind(ownerId, monthKey, operationKey, costSar, new Date().toISOString(), ownerId, monthKey, costSar, AGENT_MONTHLY_STOP_SAR).run();

    if ((result.meta.changes ?? 0) === 1) return "reserved" as const;
    const existing = await this.db.prepare("SELECT operation_key FROM agent_usage WHERE owner_id = ? AND operation_key = ?").bind(ownerId, operationKey).first<{ operation_key: string }>();
    return existing ? "duplicate" as const : "exhausted" as const;
  }

  async release(ownerId: string, operationKey: string) {
    await this.ensureReady();
    await this.db.prepare("DELETE FROM agent_usage WHERE owner_id = ? AND operation_key = ?").bind(ownerId, operationKey).run();
  }

  async saveReport(report: StoredReport) {
    await this.ensureReady();
    const now = new Date().toISOString();
    await this.db.prepare("INSERT INTO agent_reports (id, owner_id, symbol, trade_date, status, report_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, symbol, trade_date) DO UPDATE SET status = excluded.status, report_json = excluded.report_json, updated_at = excluded.updated_at").bind(report.id, report.ownerId, report.symbol, report.tradeDate, report.status, JSON.stringify(report.report), now, now).run();
  }

  async saveMessage(ownerId: string, symbol: string, message: unknown) {
    await this.ensureReady();
    await this.db.prepare("INSERT INTO agent_messages (id, owner_id, symbol, message_json, created_at) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), ownerId, symbol, JSON.stringify(message), new Date().toISOString()).run();
  }

  async usage(ownerId: string, monthKey: string) {
    await this.ensureReady();
    const row = await this.db.prepare("SELECT COALESCE(SUM(cost_sar), 0) AS used_sar FROM agent_usage WHERE owner_id = ? AND month_key = ?").bind(ownerId, monthKey).first<{ used_sar: number }>();
    return Number(row?.used_sar ?? 0);
  }

  private toReport(row: ReportRow): StoredReport {
    return { id: row.id, ownerId: row.owner_id, symbol: row.symbol, tradeDate: row.trade_date, status: row.status, report: JSON.parse(row.report_json) };
  }
}
