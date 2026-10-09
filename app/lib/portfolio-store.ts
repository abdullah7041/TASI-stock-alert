import type { D1Database } from "cloudflare:workers";
import { researchSchemaStatements } from "@/db/schema";
import { expandPortfolioEvent, foldPortfolio, type PortfolioEvent } from "@/app/lib/portfolio-core.mjs";
import { buildPortfolioBook, normalizeAccountRecordInput, previewAccountRecord, PortfolioConflict } from "@/app/lib/portfolio-core.mjs";
import type { AccountRecord, AccountRecordInput, BrokerAccountId } from "@/app/lib/evidence-types";

type AccountRow = { operation_id: string; owner_id: string; account_id: BrokerAccountId; revision: number; record_kind: AccountRecord['kind']; recorded_at: string; payload_json: string };

type Row = { operation_id: string; event_kind: PortfolioEvent["kind"]; month_key: string | null; symbol: string | null; name: string | null; shares: number | null; price_sar: number | null; cash_sar: number | null; fees_sar: number | null; reason: string | null; confirmed_at: string };

export class PortfolioStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ensureReady() { this.#ready ??= this.db.batch(researchSchemaStatements.map((sql) => this.db.prepare(sql))).then(() => undefined); return this.#ready; }
  async events(ownerId: string) {
    await this.ensureReady();
    const rows = await this.db.prepare("SELECT operation_id,event_kind,month_key,symbol,name,shares,price_sar,cash_sar,fees_sar,reason,confirmed_at FROM portfolio_events WHERE owner_id = ? ORDER BY julianday(confirmed_at), operation_id").bind(ownerId).all<Row>();
    return rows.results.map((row) => ({ operationId: row.operation_id, kind: row.event_kind, month: row.month_key ?? undefined, code: row.symbol ?? undefined, name: row.name ?? undefined, shares: row.shares ?? undefined, priceSar: row.price_sar ?? undefined, cashSar: row.cash_sar ?? undefined, feesSar: row.fees_sar ?? undefined, reason: row.reason ?? undefined, confirmedAt: row.confirmed_at }));
  }
  async view(ownerId: string) { return foldPortfolio(await this.events(ownerId)); }
  async accountRecords(ownerId: string, accountId?: BrokerAccountId): Promise<AccountRecord[]> {
    await this.ensureReady();
    const query = this.db.prepare(`SELECT * FROM portfolio_account_records WHERE owner_id = ?${accountId ? ' AND account_id = ?' : ''} ORDER BY account_id,revision`);
    const rows = await query.bind(...(accountId ? [ownerId,accountId] : [ownerId])).all<AccountRow>();
    return rows.results.map(r => {
      let payload: unknown;
      try { payload=JSON.parse(r.payload_json); }
      catch { payload={unreadablePayload:r.payload_json}; }
      // Stored data is untrusted. The account fold validates it independently,
      // so one damaged broker remains visible without blocking the other.
      return {operationId:r.operation_id,kind:r.record_kind,payload,accountId:r.account_id,revision:r.revision,recordedAt:r.recorded_at} as AccountRecord;
    });
  }
  async book(ownerId: string) { return buildPortfolioBook(await this.accountRecords(ownerId),await this.events(ownerId)); }
  async preview(ownerId: string, accountId: BrokerAccountId, input: AccountRecordInput, expectedRevision: number) {
    return previewAccountRecord(await this.accountRecords(ownerId,accountId),accountId,input,expectedRevision);
  }
  async appendAccountRecord(ownerId: string, accountId: BrokerAccountId, input: AccountRecordInput, expectedRevision: number) {
    await this.ensureReady();
    const record = normalizeAccountRecordInput(input), payload = JSON.stringify(record.payload);
    const existing = () => this.db.prepare('SELECT * FROM portfolio_account_records WHERE operation_id = ?').bind(record.operationId).first<AccountRow>();
    const exact = (row: AccountRow) => row.owner_id === ownerId && row.account_id === accountId && row.record_kind === record.kind && row.payload_json === payload;
    const previous = await existing();
    if (previous) {
      if (!exact(previous)) throw new PortfolioConflict('operationId has already been used for a different record.');
      return this.book(ownerId);
    }
    await this.preview(ownerId,accountId,record,expectedRevision);
    try {
      // One immutable insert is the commit. The unique account revision rejects
      // competing writes validated against the same cash/holdings projection.
      await this.db.prepare('INSERT INTO portfolio_account_records (operation_id,owner_id,account_id,revision,record_kind,recorded_at,payload_json) VALUES (?,?,?,?,?,?,?)')
        .bind(record.operationId,ownerId,accountId,expectedRevision+1,record.kind,new Date().toISOString(),payload).run();
    } catch (error) {
      const raced = await existing();
      if (raced && exact(raced)) return this.book(ownerId);
      const current = await this.accountRecords(ownerId,accountId);
      if (raced || current.length !== expectedRevision) throw new PortfolioConflict('Account revision changed; refresh and preview again.');
      throw error;
    }
    return this.book(ownerId);
  }
  /** The single recorded owner, for machine callers that have no session. */
  async soleOwnerId() {
    await this.ensureReady();
    const rows = await this.db.prepare("SELECT owner_id FROM portfolio_events UNION SELECT owner_id FROM portfolio_account_records").all<{ owner_id: string }>();
    if (rows.results.length > 1) throw new Error("More than one portfolio owner is recorded.");
    return rows.results[0]?.owner_id ?? null;
  }
  /**
   * The producer's contract: the folded view plus what was actually SPENT this
   * calendar month. Sells do not reduce it -- the cap is on new-buy spend, and
   * selling something does not un-spend the money.
   */
  async ledger(month: string) {
    const ownerId = await this.soleOwnerId();
    const events = ownerId ? await this.events(ownerId) : [];
    const spent = events
      .filter((event) => event.kind === "buy" && String(event.confirmedAt).slice(0, 7) === month)
      .reduce((total, event) => total + (event.shares ?? 0) * (event.priceSar ?? 0) + (event.feesSar ?? 0), 0);
    return { view: foldPortfolio(events), eventCount: events.length, spentThisMonthSar: Math.round(spent * 100) / 100, month };
  }
  async append(ownerId: string, event: PortfolioEvent) {
    await this.ensureReady();
    const existing = await this.db.prepare("SELECT owner_id FROM portfolio_events WHERE operation_id = ?").bind(event.operationId).first<{owner_id:string}>();
    if (existing?.owner_id === ownerId) return this.view(ownerId);
    if (existing) throw new Error("operationId belongs to another owner.");
    const current = await this.events(ownerId);
    const appended = expandPortfolioEvent(current, event);
    const projected = [...current, ...appended];
    foldPortfolio(projected);
    try {
      await this.db.batch(appended.map((item) => this.db.prepare("INSERT INTO portfolio_events (operation_id,owner_id,event_kind,month_key,symbol,name,shares,price_sar,cash_sar,fees_sar,reason,confirmed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").bind(item.operationId, ownerId, item.kind, item.month ?? null, item.code ?? null, item.name ?? null, item.shares ?? null, item.priceSar ?? null, item.cashSar ?? null, item.feesSar ?? 0, item.reason ?? null, item.confirmedAt)));
    } catch (error) {
      // Two identical requests may both pass the optimistic lookup. The unique
      // operation id makes the database the arbiter; only the same owner's
      // completed request is an idempotent success.
      const raced = await this.db.prepare("SELECT owner_id FROM portfolio_events WHERE operation_id = ?").bind(event.operationId).first<{owner_id:string}>();
      if (raced?.owner_id === ownerId) return this.view(ownerId);
      throw error;
    }
    return this.view(ownerId);
  }
}
