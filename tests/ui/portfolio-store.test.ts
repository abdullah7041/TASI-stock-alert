import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';
import type { D1Database } from 'cloudflare:workers';
import { PortfolioStore } from '@/app/lib/portfolio-store';
import type { AccountRecordInput } from '@/app/lib/evidence-types';
import {savedPortfolio,parseSavedPortfolio} from '@/app/lib/portfolio-core.mjs';

// Node 22 omits experimental sqlite from builtinModules; avoid Vite's DOM bundler.
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

function database() {
  const sqlite = new DatabaseSync(':memory:');
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const query = { bind(...values: unknown[]) { args=values; return query; },
      async all() { return {results:sqlite.prepare(sql).all(...args as [])}; },
      async first() { return sqlite.prepare(sql).get(...args as []) ?? null; },
      async run() { const result=sqlite.prepare(sql).run(...args as []); return {meta:{changes:Number(result.changes)}}; } };
    return query;
  };
  const db = {prepare,async batch(queries: ReturnType<typeof prepare>[]) { for (const q of queries) await q.run(); return []; }} as unknown as D1Database;
  return {sqlite,db,store:new PortfolioStore(db)};
}
const opening = (operationId='open',cashSar=100): AccountRecordInput => ({operationId,kind:'event',payload:{kind:'opening_balance',cashSar,holdings:[],occurredAt:'2026-10-01T08:00:00Z',provenance:{source:'manual'}}});
const withdrawal: AccountRecordInput = {operationId:'withdraw',kind:'event',payload:{kind:'withdrawal',cashSar:60,occurredAt:'2026-10-02T08:00:00Z',provenance:{source:'manual'}}};

describe('one saved portfolio',()=>{
  it('removes obsolete constraints without changing rows and saves repeat contributions and dividend funded buys',async()=>{
    const {store,db,sqlite}=database();
    await store.append('owner',{operationId:'open',kind:'opening_balance',cashSar:0,holdings:[],confirmedAt:'2026-10-01T00:00:00Z'});
    sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_contribution_per_owner_month ON portfolio_events(owner_id,month_key) WHERE event_kind='contribution'");
    const upgraded=new PortfolioStore(db);
    for(const [id,day] of [['deposit-1','02'],['deposit-2','03']]){
      const record:AccountRecordInput={operationId:id,kind:'event',payload:{kind:'contribution',cashSar:10,occurredAt:`2026-10-${day}T09:00:00Z`,provenance:{source:'manual'}}};
      await upgraded.appendSaved('owner',record,(await upgraded.saved('owner')).eventCount);
    }
    const dividend:AccountRecordInput={operationId:'dividend',kind:'event',payload:{kind:'dividend',cashSar:20,occurredAt:'2026-10-04T09:00:00Z',provenance:{source:'manual'}}};
    await upgraded.appendSaved('owner',dividend,3);
    const buy:AccountRecordInput={operationId:'buy',kind:'event',payload:{kind:'buy',code:'2320',name:'Al-Babtain',shares:3,priceSar:10,feesSar:0,occurredAt:'2026-10-05T09:00:00Z',provenance:{source:'manual'}}};
    expect((await upgraded.previewSaved('owner',buy,4)).view.cashSar).toBe(10);
    expect((await upgraded.appendSaved('owner',buy,4)).view.cashSar).toBe(10);
    expect((await upgraded.saved('owner')).events[0].operationId).toBe('open');
    const fee:AccountRecordInput={operationId:'fee',kind:'event',payload:{kind:'fee',cashSar:5,occurredAt:'2026-10-06T09:00:00Z',provenance:{source:'manual'}}};
    await upgraded.appendSaved('owner',fee,5);
    expect((await upgraded.saved('owner')).view.cashSar).toBe(5);
    expect(()=>sqlite.prepare("INSERT INTO portfolio_events(operation_id,owner_id,event_kind,symbol,name,shares,price_sar,fees_sar,confirmed_at) VALUES('over','owner','buy','2320','Al-Babtain',1,6,0,'2026-10-07T09:00:00Z')").run()).toThrow(/cash/i);
  });
  it('accepts an identical commit between its retry lookup and revision validation',async()=>{
    const {store}=database();
    await store.append('owner',{operationId:'open',kind:'opening_balance',cashSar:100,holdings:[],confirmedAt:'2026-10-01T00:00:00Z'});
    const read=store.saved.bind(store);
    vi.spyOn(store,'saved').mockImplementationOnce(async(owner)=>{const before=await read(owner);await store.appendSaved(owner,withdrawal,1);return before;});
    expect((await store.appendSaved('owner',withdrawal,1)).eventCount).toBe(2);
  });
  it('accepts the same saved history after Python reorders JSON object keys',()=>{
    const saved=savedPortfolio([{operationId:'open',kind:'opening_balance',cashSar:0,confirmedAt:'2026-09-07T00:00:00Z'},
      {operationId:'position',kind:'opening_position',code:'2320',name:'Al-Babtain',shares:12,priceSar:64.26,confirmedAt:'2026-09-07T00:00:00Z'}]);
    saved.view.holdings=saved.view.holdings.map(h=>Object.fromEntries(Object.entries(h).reverse()) as typeof h);
    expect(parseSavedPortfolio(JSON.parse(JSON.stringify(saved))).view.holdings[0].shares).toBe(12);
  });
  it('replays saved positions and the full EIC sale without an account opening',async()=>{
    const {store}=database();
    await store.append('owner',{operationId:'opening',kind:'opening_balance',cashSar:0,confirmedAt:'2026-09-07T00:00:00Z',holdings:[{code:'2320',name:'Al-Babtain',shares:12,avgCostSar:64.26},{code:'8313',name:'Rasan',shares:11,avgCostSar:107.45},{code:'1303',name:'EIC',shares:104,avgCostSar:12.41}]});
    await store.append('owner',{operationId:'sale',kind:'sell',code:'1303',name:'EIC',shares:104,priceSar:15.25,feesSar:2.54,confirmedAt:'2026-09-27T14:14:45.853Z'});
    const saved=await store.saved('owner');
    expect(saved.view.holdings.map(h=>[h.code,h.shares])).toEqual([['2320',12],['8313',11]]);
    expect(saved.view.cashSar).toBe(1583.46);
    expect(saved.view.policyStatus).toBe('unconfigured');
    expect(saved.eventCount).toBe(5);
    expect(saved.events.at(-1)?.operationId).toBe('sale');
    expect((await store.saved('other')).view.cashSar).toBeNull();
    expect((await store.saved('other')).status).toBe('empty');
  });
  it('previews without writing and permits only one competing spend and exact retries',async()=>{
    const {store}=database();
    await store.append('owner',{operationId:'open-legacy',kind:'opening_balance',cashSar:100,holdings:[],confirmedAt:'2026-10-01T00:00:00Z'});
    expect((await store.previewSaved('owner',withdrawal,1)).view.cashSar).toBe(40);
    expect((await store.saved('owner')).eventCount).toBe(1);
    const second={...withdrawal,operationId:'withdraw-2'};
    const results=await Promise.allSettled([store.appendSaved('owner',withdrawal,1),store.appendSaved('owner',second,1)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const retry=await store.appendSaved('owner',withdrawal,1);
    expect(retry.eventCount).toBe(2);
    await expect(store.appendSaved('owner',{...withdrawal,payload:{...withdrawal.payload,cashSar:20}},2)).rejects.toThrow(/operation/i);
  });
});

describe('account storage',()=>{
  it('retries a committed record exactly once after its confirmation read fails',async()=>{
    const {store}=database();
    const read=vi.spyOn(store,'book').mockRejectedValueOnce(new Error('Readback unavailable'));
    await expect(store.appendAccountRecord('a','al_rajhi',opening(),0)).rejects.toThrow('Readback unavailable');
    expect((await store.accountRecords('a','al_rajhi')).length).toBe(1);
    read.mockRestore();
    const retried=await store.appendAccountRecord('a','al_rajhi',opening(),0);
    expect(retried.accounts[0].cashSar).toBe(100);
    expect(retried.accounts[0].revision).toBe(1);
    expect((await store.accountRecords('a','al_rajhi')).length).toBe(1);
  });
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
    const broken=await store.book('new');
    expect(broken.accounts[0].error).toMatch(/verified/i);
    expect(broken.accounts[0].revision).toBe(1);
    expect(broken.accounts[0].cashSar).toBeNull();
    const healthy=await store.appendAccountRecord('new','al_ahli',opening('healthy',400),0);
    expect(healthy.accounts[0].error).toMatch(/verified/i);
    expect(healthy.accounts[1].cashSar).toBe(400);
    expect(healthy.combined.cashSar).toBeNull();
    expect((await store.appendAccountRecord('new','al_ahli',opening('healthy',400),0)).accounts[1].revision).toBe(1);
  });
});
