import type { D1Database } from "cloudflare:workers";
import { researchSchemaStatements } from "@/db/schema";
import { foldPortfolio, type PortfolioEvent } from "@/app/lib/portfolio-core.mjs";

type Row = { operation_id: string; event_kind: PortfolioEvent["kind"]; month_key: string | null; symbol: string | null; name: string | null; shares: number | null; price_sar: number | null; cash_sar: number | null; fees_sar: number | null; reason: string | null; confirmed_at: string };

export class PortfolioStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ensureReady() { this.#ready ??= this.db.batch(researchSchemaStatements.map((sql) => this.db.prepare(sql))).then(() => undefined); return this.#ready; }
  async events(ownerId: string) {
    await this.ensureReady();
    const rows = await this.db.prepare("SELECT operation_id,event_kind,month_key,symbol,name,shares,price_sar,cash_sar,fees_sar,reason,confirmed_at FROM portfolio_events WHERE owner_id = ? ORDER BY confirmed_at, operation_id").bind(ownerId).all<Row>();
    return rows.results.map((row) => ({ operationId: row.operation_id, kind: row.event_kind, month: row.month_key ?? undefined, code: row.symbol ?? undefined, name: row.name ?? undefined, shares: row.shares ?? undefined, priceSar: row.price_sar ?? undefined, cashSar: row.cash_sar ?? undefined, feesSar: row.fees_sar ?? undefined, reason: row.reason ?? undefined, confirmedAt: row.confirmed_at }));
  }
  async view(ownerId: string) { return foldPortfolio(await this.events(ownerId)); }
  async append(ownerId: string, event: PortfolioEvent) {
    await this.ensureReady();
    const existing = await this.db.prepare("SELECT operation_id FROM portfolio_events WHERE operation_id = ?").bind(event.operationId).first<{operation_id:string}>();
    if (existing) return this.view(ownerId);
    const projected = [...await this.events(ownerId), event];
    foldPortfolio(projected);
    await this.db.prepare("INSERT INTO portfolio_events (operation_id,owner_id,event_kind,month_key,symbol,name,shares,price_sar,cash_sar,fees_sar,reason,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(event.operationId, ownerId, event.kind, event.month ?? null, event.code ?? null, event.name ?? null, event.shares ?? null, event.priceSar ?? null, event.cashSar ?? null, event.feesSar ?? 0, event.reason ?? null, event.confirmedAt).run();
    return this.view(ownerId);
  }
}
