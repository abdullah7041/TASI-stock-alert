import { createRequire } from 'node:module';
import { afterEach, expect, test, vi } from 'vitest';
import type { D1Database } from 'cloudflare:workers';
import { env } from './cloudflare-workers-stub';
import { GET,POST } from '@/app/api/copilot/route';
import { GET as machineGet,POST as machinePost } from '@/app/api/holding-reviews/route';
import { defaultProfile } from '@/app/lib/holding-secretary-core';
import { PortfolioStore } from '@/app/lib/portfolio-store';

const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
function setup(){
  const sqlite=new DatabaseSync(':memory:');
  const prepare=(sql:string)=>{let args:unknown[]=[];const query={bind(...values:unknown[]){args=values;return query;},async all(){return {results:sqlite.prepare(sql).all(...args as [])};},async first(){return sqlite.prepare(sql).get(...args as [])??null;},async run(){return {meta:{changes:Number(sqlite.prepare(sql).run(...args as []).changes)}};}};return query;};
  const db={prepare,async batch(queries:ReturnType<typeof prepare>[]){return Promise.all(queries.map(q=>q.run()));}} as unknown as D1Database;
  env.DB=db;env.AGENT_OWNER_EMAIL='owner@example.test';env.DASHBOARD_INGEST_TOKEN='test-ingest';
  return {sqlite,db};
}
function owner(body?:unknown){return new Request('https://example.test/api/copilot',{method:body?'POST':'GET',headers:{origin:'https://example.test','content-type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:body?JSON.stringify(body):undefined});}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const key of Object.keys(env))delete env[key];});

test('profile confirmation persists outside chat and retries without an AI key',async()=>{
  const {sqlite}=setup();
  const initial=await (await GET(owner())).json();
  expect(initial.secretary?.profile).toBeNull();expect(initial.messages).toEqual([]);
  const input={operation:'save_profile',profile:defaultProfile,expectedRevision:0,operationId:'profile'};
  expect((await POST(owner(input))).status).toBe(200);
  expect((await POST(owner(input))).status).toBe(200);
  const saved=await (await GET(owner())).json();
  expect(saved.secretary.profile.revision).toBe(1);expect(saved.secretary.profile.objective).toContain('wealth');
  expect((await POST(owner({...input,operationId:'different',profile:{...defaultProfile,objective:'Updated'}}))).status).toBe(409);
  sqlite.close();
});

test('company confirmation cannot use an unconfirmed holding or change broker balances',async()=>{
  const {sqlite,db}=setup();
  await POST(owner({operation:'save_profile',profile:defaultProfile,expectedRevision:0,operationId:'profile'}));
  const input={operation:'confirm_case',case:{symbol:'2320',reasons:'Owner reason',supportingEvidence:'Owner evidence',risks:'Demand',reconsiderWhen:'Case changes',sourceRefs:[]},expectedRevision:0,profileRevision:1,operationId:'case'};
  expect((await POST(owner(input))).status).toBe(409);
  const portfolio=new PortfolioStore(db);
  await portfolio.append('owner',{operationId:'opening',kind:'opening_balance',cashSar:100,holdings:[{code:'2320',name:'Al-Babtain',shares:2,avgCostSar:25}],confirmedAt:'2026-10-01T08:00:00Z'});
  expect((await POST(owner(input))).status).toBe(200);
  expect((await portfolio.saved('owner')).view.cashSar).toBe(100);
  expect((await portfolio.saved('owner')).eventCount).toBe(2);
  const saved=await (await GET(owner())).json();expect(saved.secretary.caseHistory).toHaveLength(1);expect(saved.holdingCompanies[0].portfolioContext.shares).toBe(2);
  sqlite.close();
});

test('machine reviews require authentication and cannot choose an owner',async()=>{
  const {sqlite}=setup();
  expect((await machineGet(new Request('https://example.test/api/holding-reviews'))).status).toBe(401);
  expect((await machinePost(new Request('https://example.test/api/holding-reviews',{method:'POST',headers:{authorization:'Bearer test-ingest','content-type':'application/json'},body:JSON.stringify({ownerId:'someone-else'})}))).status).toBe(400);
  sqlite.close();
});
