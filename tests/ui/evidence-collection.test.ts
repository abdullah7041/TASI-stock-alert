import { createRequire } from 'node:module';
import { expect, test } from 'vitest';
import type { D1Database } from 'cloudflare:workers';
import { EvidenceStore } from '@/app/lib/evidence-store';
import { POST } from '@/app/api/evidence/queue/ingest/route';
import { env } from './cloudflare-workers-stub';
const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
function database() {
  const sqlite=new DatabaseSync(':memory:');
  const prepare=(sql:string)=>{let args:unknown[]=[];const q={bind(...v:unknown[]){args=v;return q;},async all(){return {results:sqlite.prepare(sql).all(...args as [])};},async first(){return sqlite.prepare(sql).get(...args as [])??null;},async run(){return sqlite.prepare(sql).run(...args as []);}};return q;};
  const db={prepare,async batch(q:ReturnType<typeof prepare>[]){return Promise.all(q.map(x=>x.run()));}} as unknown as D1Database;
  return {db,sqlite,store:new EvidenceStore(db)};
}
const entry={title:'Dated notice',url:'https://www.saudiexchange.sa/filing',retrieved_at:'2026-10-22T05:15:00Z',symbol:'1150',published_at:'2026-10-21T09:00:00+03:00',source_published_at:'21/10/2026 09:00:00'};
const receipt={runId:'first',attemptedAt:entry.retrieved_at,status:'content' as const,count:1};
test('persists failed and empty receipts distinctly while retaining historical queue links',async()=>{
  const {store}=database();
  await store.saveCollection(receipt,[entry]);
  await store.saveCollection({...receipt,runId:'failed',attemptedAt:'2026-10-22T12:30:00Z',status:'failed',count:0,error:'Source unavailable'},[]);
  expect((await store.latestCollection())?.status).toBe('failed');
  expect(await store.queue()).toEqual([entry]);
  await store.saveCollection({...receipt,runId:'empty',attemptedAt:'2026-10-23T05:15:00Z',status:'empty',count:0},[]);
  expect((await store.latestCollection())?.status).toBe('empty');
  expect((await store.latestCollection())?.count).toBe(0);
  expect(await store.queue()).toEqual([entry]);
});
test('exposes owner-scoped reviewed revisions without leaking another owners later record',async()=>{
  const {store}=database();
  const a={symbol:'1150',reportPeriod:'2026-Q1',analystNotes:'Owner A'};
  const first=await store.saveReviewed(a as never,'a');
  await store.saveReviewed({...a,analystNotes:'Owner B'} as never,'b');
  expect(await store.currentWithRevisions('a')).toEqual([first]);
  expect(await store.current('a')).toEqual([a]);
});
test('ingests failure receipts and preserves source symbols and publication timestamps',async()=>{
  const {db,store}=database();env.DB=db;env.DASHBOARD_INGEST_TOKEN='test-only';
  const send=(body:unknown)=>POST(new Request('https://test/api/evidence/queue/ingest',{method:'POST',headers:{authorization:'Bearer test-only','content-type':'application/json'},body:JSON.stringify(body)}));
  expect((await send({receipt,announcements:[entry],retrievedAt:receipt.attemptedAt})).status).toBe(200);
  expect(await store.queue()).toEqual([entry]);
  expect((await send({receipt:{...receipt,runId:'failed',status:'failed',count:0,error:'Unavailable'},announcements:[],retrievedAt:receipt.attemptedAt})).status).toBe(200);
  expect((await store.latestCollection())?.status).toBe('failed');
  expect((await send({receipt:{...receipt,runId:'bad',status:'empty',count:1},announcements:[entry],retrievedAt:receipt.attemptedAt})).status).toBe(400);
  delete env.DB;delete env.DASHBOARD_INGEST_TOKEN;
});

test('retains corrected issuer content and the newest receipt when an older collection arrives late',async()=>{
  const {store}=database();
  const corrected={...entry,title:'Corrected notice'};
  await store.saveCollection({...receipt,runId:'new',attemptedAt:'2026-10-22T12:30:00Z'},[corrected]);
  await store.saveCollection({...receipt,runId:'old',attemptedAt:'2026-10-22T05:15:00Z'},[entry]);
  expect(await store.queue()).toEqual([corrected]);
  expect((await store.latestCollection())?.runId).toBe('new');
});
test('orders receipt and queue timestamps chronologically across equivalent time zone formats',async()=>{
  const {store}=database();
  const corrected={...entry,title:'Corrected notice'};
  await store.saveCollection({...receipt,runId:'new',attemptedAt:'2026-10-22T10:00:00Z'},[corrected]);
  await store.saveCollection({...receipt,runId:'old',attemptedAt:'2026-10-22T12:30:00+03:00'},[entry]);
  expect((await store.latestCollection())?.runId).toBe('new');
  expect(await store.queue()).toEqual([corrected]);
  await store.saveQueue([entry],'2026-10-22T13:00:00+03:00');
  expect(await store.queue()).toEqual([corrected]);
  await store.saveQueue([{...entry,title:'Newest legacy notice'}],'2026-10-22T10:30:00Z');
  await store.saveQueue([entry],'2026-10-22T13:15:00+03:00');
  expect((await store.queue())[0].title).toBe('Newest legacy notice');
});
test('replayed collection IDs cannot rewrite issuer content or add links under an immutable receipt',async()=>{
  const {store}=database();
  await store.saveCollection(receipt,[entry]);
  await store.saveCollection({...receipt,count:2,attemptedAt:'2026-10-23T05:15:00Z'},[{...entry,title:'Rewritten'}, {...entry,url:'https://www.saudiexchange.sa/extra'}]);
  expect(await store.queue()).toEqual([entry]);
  expect(await store.latestCollection()).toEqual(receipt);
});
