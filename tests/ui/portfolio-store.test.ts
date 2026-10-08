import { DatabaseSync } from 'node:sqlite';
import { describe, it, expect } from 'vitest';
import type { D1Database } from 'cloudflare:workers';
import { PortfolioStore } from '@/app/lib/portfolio-store';
import type { AccountRecordInput } from '@/app/lib/evidence-types';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const query = { bind(...values: unknown[]) { args=values; return query; },
      async all() { return {results:sqlite.prepare(sql).all(...args as [])}; },
      async first() { return sqlite.prepare(sql).get(...args as []) ?? null; },
      async run() { return sqlite.prepare(sql).run(...args as []); } };
    return query;
  };
  const db = {prepare,async batch(queries: ReturnType<typeof prepare>[]) { for (const q of queries) await q.run(); return []; }} as unknown as D1Database;
  return {sqlite,store:new PortfolioStore(db)};
}
const opening = (operationId='open',cashSar=100): AccountRecordInput => ({operationId,kind:'event',payload:{kind:'opening_balance',cashSar,holdings:[],occurredAt:'2026-10-01T08:00:00Z',provenance:{source:'manual'}}});
const withdrawal: AccountRecordInput = {operationId:'withdraw',kind:'event',payload:{kind:'withdrawal',cashSar:60,occurredAt:'2026-10-02T08:00:00Z',provenance:{source:'manual'}}};

describe('account storage',()=>{
  it('isolates accounts and owners and accepts only exact normalized retries',async()=>{
    const {store}=database();
    await store.appendAccountRecord('a','al_rajhi',opening(),0);
    await store.appendAccountRecord('a','al_ahli',opening('ahli',400),0);
    expect((await store.appendAccountRecord('a','al_rajhi',opening(),0)).accounts[0].cashSar).toBe(100);
    await expect(store.appendAccountRecord('a','al_rajhi',opening('open',200),1)).rejects.toThrow(/operation/i);
    await expect(store.appendAccountRecord('b','al_rajhi',opening(),0)).rejects.toThrow(/operation/i);
    expect((await store.book('b')).accounts[0].cashSar).toBeNull();
    expect((await store.book('a')).combined.cashSar).toBe(500);
    expect(await store.soleOwnerId()).toBe('a');
  });
  it('rejects stale competing writes and previews without persisting anything',async()=>{
    const {store}=database();
    await store.appendAccountRecord('a','al_rajhi',opening(),0);
    const buy: AccountRecordInput={operationId:'buy',kind:'event',payload:{kind:'buy',code:'1303',name:'EIC',shares:6,priceSar:10,feesSar:0,occurredAt:'2026-10-02T09:00:00Z',provenance:{source:'manual'}}};
    expect((await store.preview('a','al_rajhi',buy,1)).projected.cashSar).toBe(40);
    expect((await store.accountRecords('a','al_rajhi')).length).toBe(1);
    const results=await Promise.allSettled([store.appendAccountRecord('a','al_rajhi',withdrawal,1),store.appendAccountRecord('a','al_rajhi',buy,1)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect((await store.book('a')).accounts[0].cashSar).toBe(40);
    await expect(store.appendAccountRecord('a','al_rajhi',{operationId:'correct',kind:'correction',payload:{targetOperationId:'open',replacement:null,reason:'wrong'}},1)).rejects.toThrow(/revision/i);
  });
  it('keeps legacy rows unassigned and rejects ambiguous machine ownership and corrupted records visibly',async()=>{
    const {store,sqlite}=database();
    await store.ensureReady();
    sqlite.prepare("INSERT INTO portfolio_events (operation_id,owner_id,event_kind,cash_sar,confirmed_at) VALUES ('legacy','old','opening_balance',30,'2026-09-01T00:00:00Z')").run();
    await store.appendAccountRecord('new','al_rajhi',opening(),0);
    expect((await store.book('old')).legacy.events).toHaveLength(1);
    expect((await store.book('old')).accounts[0].initialized).toBe(false);
    await expect(store.soleOwnerId()).rejects.toThrow(/owner/i);
    sqlite.prepare("UPDATE portfolio_account_records SET payload_json = 'broken' WHERE operation_id='open'").run();
    await expect(store.book('new')).rejects.toThrow(/JSON/i);
  });
});
