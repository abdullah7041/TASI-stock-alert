import { createRequire } from 'node:module';
import { afterEach, expect, test, vi } from 'vitest';
import type { D1Database } from 'cloudflare:workers';
import { answerPortfolioQuestion } from '@/app/lib/copilot-service';
import { ResearchStore } from '@/app/lib/research-store';
import { CopilotStore } from '@/app/lib/copilot-store';
import { HoldingSecretaryStore } from '@/app/lib/holding-secretary-store';
import { defaultProfile } from '@/app/lib/holding-secretary-core';
import { PortfolioStore } from '@/app/lib/portfolio-store';
import { EvidenceStore } from '@/app/lib/evidence-store';
import { reviewHolding, draftHoldingCase, holdingReviewSummary, secretaryConversation } from '@/app/lib/holding-secretary-service';

const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
function database() {
  const sqlite=new DatabaseSync(':memory:');
  const prepare=(sql:string)=>{
    let args:unknown[]=[];
    const query={bind(...values:unknown[]){args=values;return query;},
      async all(){return {results:sqlite.prepare(sql).all(...args as [])};},
      async first(){return sqlite.prepare(sql).get(...args as [])??null;},
      async run(){const result=sqlite.prepare(sql).run(...args as []);return {meta:{changes:Number(result.changes)}};}};
    return query;
  };
  return {sqlite,db:{prepare,async batch(queries:ReturnType<typeof prepare>[]){return Promise.all(queries.map(q=>q.run()));}} as unknown as D1Database};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
const reply=(action='WATCH')=>({answer:'Company evidence is incomplete.',draft:{symbol:'2320',action,conditions:'Review official results.',invalidation:'A reviewed filing changes the case.'}});

test('failed portfolio chat leaves no reserved allowance or saved answer',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T06:00:00Z'));
  const {db,sqlite}=database();
  vi.stubGlobal('fetch',async()=>new Response('unavailable',{status:503}));
  await expect(answerPortfolioQuestion({ownerId:'owner',db,apiKey:'test-only',chatModel:'configured'},'What changed?')).rejects.toMatchObject({status:502});
  expect(await new ResearchStore(db).usage('owner','2026-10')).toBe(0);
  expect((await new CopilotStore(db).history('owner')).messages).toHaveLength(0);
  sqlite.close();
});

test('model HOLD advice cannot pass an unconfigured policy or consume allowance',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-22T06:00:00Z'));
  const {db,sqlite}=database();
  vi.stubGlobal('fetch',async()=>Response.json({output_text:JSON.stringify(reply('HOLD'))}));
  await expect(answerPortfolioQuestion({ownerId:'owner',db,apiKey:'test-only',chatModel:'configured'},'Review my holding')).rejects.toThrow(/action|policy|research|draft/i);
  expect(await new ResearchStore(db).usage('owner','2026-10')).toBe(0);
  expect((await new CopilotStore(db).history('owner')).messages).toHaveLength(0);
  sqlite.close();
});

const source='https://www.saudiexchange.sa/issuer/2320/results';
async function seeded() {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-23T06:00:00Z'));
  const databaseValue=database(), {db,sqlite}=databaseValue;
  const store=new HoldingSecretaryStore(db);
  await store.saveProfile('owner',defaultProfile,0,'profile');
  await new PortfolioStore(db).append('owner',{operationId:'opening',kind:'opening_balance',cashSar:100,holdings:[{code:'2320',name:'Al-Babtain',shares:2,avgCostSar:25}],confirmedAt:'2026-10-01T08:00:00Z'});
  await store.confirmCase('owner',{symbol:'2320',reasons:'Long-term company case',supportingEvidence:'Reviewed results',risks:'Demand and leverage',reconsiderWhen:'Cash conversion weakens',sourceRefs:[source]},0,'case',1);
  const evidence=new EvidenceStore(db);await evidence.ensureReady();
  sqlite.prepare('INSERT INTO evidence_records (revision_id,owner_id,symbol,report_period,evidence_json,reviewed_at) VALUES (?,?,?,?,?,?)').run('evidence-1','owner','2320','2026-Q2',JSON.stringify({symbol:'2320',sourceUrl:source,publishedAt:'2026-08-01T08:00:00Z',retrievedAt:'2026-10-20T08:00:00Z',reportPeriod:'2026-Q2',metrics:{profitability_direction:{raw_value:'10',prior_value:'9',grade:3,explanation:'Reviewed growth',source_url:source}}}),'2026-10-20T08:00:00Z');
  await evidence.saveCollection({runId:'run-1',attemptedAt:'2026-10-22T05:15:00Z',status:'empty',count:0},[]);
  return {...databaseValue,store,evidence,context:{ownerId:'owner',db,apiKey:'test-only',chatModel:'configured'}};
}
const reviewReply=()=>({action:'RESEARCH_MORE',changed:'Reviewed company results available.',supporting:'Dated profitability evidence.',contrary:'Coverage is incomplete.',implications:'Compare hold and reduce scenarios after reviewing evidence.',missing:'Latest quarter may not be covered.',questions:'Has cash conversion changed?',sourceRefs:[source]});

test('owner responses expose each latest collection outcome while preserving historical reviews',async()=>{
  const {context,evidence,sqlite}=await seeded();
  const fetchReply=vi.fn(async()=>Response.json({output_text:JSON.stringify(reviewReply())}));
  vi.stubGlobal('fetch',fetchReply);
  const review=await reviewHolding(context,'2320');
  const emptyResponse=await secretaryConversation(context);
  expect(emptyResponse).toHaveProperty('collection',{runId:'run-1',attemptedAt:'2026-10-22T05:15:00Z',status:'empty',count:0});
  const content={runId:'content',attemptedAt:'2026-10-23T05:15:00Z',status:'content' as const,count:1};
  await evidence.saveCollection(content,[{title:'New official notice',url:source,symbol:'2320',retrieved_at:content.attemptedAt}]);
  expect(await secretaryConversation(context)).toHaveProperty('collection',content);
  const failed={runId:'failed',attemptedAt:'2026-10-23T12:30:00Z',status:'failed' as const,count:0,error:'Official feed unavailable'};
  await evidence.saveCollection(failed,[]);
  const failedResponse=await secretaryConversation(context);
  expect(failedResponse).toHaveProperty('collection',failed);
  expect(failedResponse.secretary.reviews).toEqual([review]);
  expect(fetchReply).toHaveBeenCalledTimes(1);
  sqlite.close();
});

test('unchanged holding evidence reuses a provisional review without another AI charge',async()=>{
  const {context,store,db,evidence,sqlite}=await seeded();
  let calls=0;vi.stubGlobal('fetch',async()=>{calls++;return Response.json({output_text:JSON.stringify(reviewReply())});});
  const first=await reviewHolding(context,'2320');
  expect(first.evidenceRevisions).toEqual(['evidence-1']);
  expect(first.collectionRunId).toBe('run-1');
  expect(first.sources?.[0]).toMatchObject({url:source,publishedAt:'2026-08-01T08:00:00Z',reviewedAt:'2026-10-20T08:00:00Z',kind:'reviewed'});
  await evidence.saveCollection({runId:'run-2',attemptedAt:'2026-10-22T12:30:00Z',status:'empty',count:0},[]);
  const second=await reviewHolding(context,'2320');
  expect(second.id).toBe(first.id);expect(calls).toBe(1);
  expect((await store.view('owner')).cases[0].revision).toBe(1);
  expect((await store.view('owner')).reviews).toHaveLength(1);
  expect(await new ResearchStore(db).usage('owner','2026-10')).toBe(0.15);
  sqlite.close();
});

test('unknown citations and trading actions cannot persist or consume review budget',async()=>{
  const {context,store,db,sqlite}=await seeded();
  for(const output of [{...reviewReply(),sourceRefs:['https://invented.example/results']},{...reviewReply(),action:'REDUCE'}]){
    vi.stubGlobal('fetch',async()=>Response.json({output_text:JSON.stringify(output)}));
    await expect(reviewHolding(context,'2320')).rejects.toThrow(/source|citation|action|policy/i);
    expect((await store.view('owner')).reviews.filter(r=>r.status==='provisional')).toHaveLength(0);
  }
  const rows=sqlite.prepare('SELECT COUNT(*) AS count FROM agent_usage').get() as {count:number};
  expect(rows.count).toBe(0);expect(await new ResearchStore(db).usage('owner','2026-10')).toBe(0);
  sqlite.close();
});

test('failed collection blocks current interpretation and leaves confirmed cases untouched',async()=>{
  const {context,store,evidence,sqlite}=await seeded();
  await evidence.saveCollection({runId:'failed',attemptedAt:'2026-10-23T05:15:00Z',status:'failed',count:0,error:'Source unavailable'},[]);
  let calls=0;vi.stubGlobal('fetch',async()=>{calls++;return Response.json({});});
  const review=await reviewHolding(context,'2320');
  expect(review.status).toBe('incomplete');expect(review.missing).toMatch(/collection|source|failed/i);expect(calls).toBe(0);
  expect((await holdingReviewSummary(context)).collection?.status).toBe('failed');
  expect((await store.view('owner')).cases[0].revision).toBe(1);
  sqlite.close();
});

test('title-only updates cannot be promoted into verified financial conclusions',async()=>{
  const {context,evidence,sqlite}=await seeded();
  sqlite.prepare('DELETE FROM evidence_records').run();
  await evidence.saveCollection({runId:'title',attemptedAt:'2026-10-23T05:15:00Z',status:'content',count:1},[{title:'Company announces results',url:source,retrieved_at:'2026-10-23T05:15:00Z',symbol:'2320',published_at:'2026-10-22T12:00:00Z'}]);
  let calls=0;vi.stubGlobal('fetch',async()=>{calls++;return Response.json({output_text:JSON.stringify(reviewReply())});});
  const review=await reviewHolding(context,'2320');
  expect(review.status).toBe('incomplete');expect(review.missing).toMatch(/reviewed|title|detail/i);
  expect(calls).toBe(0);sqlite.close();
});

test('only confirmed holdings can receive a company case draft',async()=>{
  const {context,sqlite}=await seeded();
  await expect(draftHoldingCase(context,'1303')).rejects.toMatchObject({status:409});
  sqlite.close();
});

test('ordinary chat receives the persisted profile and reviewed company case beyond message history',async()=>{
  const {context,sqlite}=await seeded();
  let sent:Record<string,unknown>|undefined;
  vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{sent=JSON.parse(String(init.body));return Response.json({output_text:JSON.stringify(reply())});});
  await answerPortfolioQuestion(context as typeof context&{apiKey:string;chatModel:string},'Why do I own this?');
  const input=JSON.parse(String(sent?.input));
  expect(input.evidence.secretary.profile.objective).toContain('wealth');
  expect(input.evidence.secretary.cases[0].reasons).toBe('Long-term company case');
  expect(input.evidence.reviewed[0].revisionId).toBe('evidence-1');
  sqlite.close();
});

test('new evidence makes the previous review visibly pending until it is reassessed',async()=>{
  const {context,sqlite}=await seeded();
  vi.stubGlobal('fetch',async()=>Response.json({output_text:JSON.stringify(reviewReply())}));
  await reviewHolding(context,'2320');
  sqlite.prepare("UPDATE evidence_records SET revision_id='evidence-2', evidence_json=REPLACE(evidence_json,'Reviewed growth','New contrary evidence') WHERE revision_id='evidence-1'").run();
  const summary=await holdingReviewSummary(context);
  expect(summary.items[0].status).toBe('pending');expect(summary.items[0].reviewId).toBeNull();
  sqlite.close();
});

test('an exhausted budget leaves one pending review that completes after allowance becomes available',async()=>{
  const {context,sqlite,store,db}=await seeded();
  const usage=new ResearchStore(db);await usage.ensureReady();
  sqlite.prepare('INSERT INTO agent_usage (owner_id,month_key,operation_key,cost_sar,created_at) VALUES (?,?,?,?,?)').run('owner','2026-10','other-usage',45,'2026-10-23T05:00:00Z');
  let calls=0;vi.stubGlobal('fetch',async()=>{calls++;return Response.json({output_text:JSON.stringify(reviewReply())});});
  const pending=await reviewHolding(context,'2320');
  expect(pending.status).toBe('pending');expect((await reviewHolding(context,'2320')).id).toBe(pending.id);expect(calls).toBe(0);
  sqlite.prepare("DELETE FROM agent_usage WHERE operation_key='other-usage'").run();
  expect((await reviewHolding(context,'2320')).status).toBe('provisional');expect(calls).toBe(1);
  expect((await store.view('owner')).cases[0].revision).toBe(1);
  sqlite.close();
});

test('retrieving and reapproving identical company facts does not charge for another interpretation',async()=>{
  const {context,sqlite,db}=await seeded();
  let calls=0;vi.stubGlobal('fetch',async()=>{calls++;return Response.json({output_text:JSON.stringify(reviewReply())});});
  const initial=await reviewHolding(context,'2320');
  sqlite.prepare("UPDATE evidence_records SET revision_id='evidence-2',evidence_json=json_set(evidence_json,'$.retrievedAt','2026-10-23T05:15:00Z'),reviewed_at='2026-10-23T05:20:00Z'").run();
  expect((await reviewHolding(context,'2320')).id).toBe(initial.id);expect(calls).toBe(1);
  expect(await new ResearchStore(db).usage('owner','2026-10')).toBe(0.15);
  sqlite.close();
});

test('an abandoned review reservation can recover without waiting for evidence to change',async()=>{
  const {context,sqlite}=await seeded();
  vi.stubGlobal('fetch',async()=>Response.json({output_text:JSON.stringify(reviewReply())}));
  await reviewHolding(context,'2320');
  // Simulate termination after reservation/provider work but before saving a result.
  sqlite.prepare("DELETE FROM holding_secretary_entries WHERE kind='review'").run();
  sqlite.prepare("UPDATE agent_usage SET created_at='2026-10-23T05:00:00Z'").run();
  expect((await reviewHolding(context,'2320')).status).toBe('provisional');
  sqlite.close();
});

test('the provider is offered only actions that generated-reply validation accepts',async()=>{
  const {context,sqlite}=await seeded();
  vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{
    const sent=JSON.parse(String(init.body));
    const allowed=sent.text.format.schema.properties.draft.anyOf[1].properties.action.enum as string[];
    return Response.json({output_text:JSON.stringify(reply(allowed.includes('HOLD')?'HOLD':'WATCH'))});
  });
  const result=await answerPortfolioQuestion(context as typeof context&{apiKey:string;chatModel:string},'Review my holding');
  expect(result.reply.draft?.action).toBe('WATCH');sqlite.close();
});

test('a large announcement history remains bounded and exposes omitted coverage',async()=>{
  const {context,evidence,sqlite}=await seeded();
  const announcements=Array.from({length:101},(_,i)=>({title:`Official notice ${i}`,url:`${source}?notice=${i}`,retrieved_at:'2026-10-23T05:15:00Z',published_at:'2026-10-22T12:00:00Z',symbol:'2320'}));
  await evidence.saveCollection({runId:'many',attemptedAt:'2026-10-23T05:15:00Z',status:'content',count:101},announcements);
  vi.stubGlobal('fetch',async()=>Response.json({output_text:JSON.stringify(reviewReply())}));
  const result=await reviewHolding(context,'2320');
  expect(result.status).toBe('provisional');expect(result.sources!.length).toBeLessThanOrEqual(40);
  expect(result.missing).toMatch(/omitted|bounded|older notices/i);sqlite.close();
});
