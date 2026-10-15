import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ActionCockpit } from '@/app/components/ActionCockpit';
import { EvidenceReviewForm } from '@/app/components/EvidenceReviewForm';
import { IntelligenceBoard } from '@/app/components/IntelligenceBoard';
import { buildPortfolioBook } from '@/app/lib/portfolio-core.mjs';
import type { DashboardPayload } from '@/app/lib/dashboard-types';
import saved from '../fixtures/friendly-dashboard.json';
import { evidenceMetricFields, validateEvidenceRecord } from '@/app/lib/evidence-review-core.mjs';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });

test.each([true,false])('historical headlines never explain a current movement when news retrieval succeeded=%s',ok=>{
 const snapshot={...saved,tradeDate:'2026-10-15',asOf:'2026-10-15T09:00:00Z',expectedPriceDate:'2026-10-14',
   digestRecords:[{...saved.digestRecords[0],news:{ok,headlines:[{title:'Historical results',link:'https://www.saudiexchange.sa/old-results',published:'2026-09-01T06:00:00Z'}]}}]};
 render(<IntelligenceBoard currentOnly snapshot={snapshot as unknown as DashboardPayload['snapshot']} alerts={[{
   alertId:'current',code:saved.digestRecords[0].code,name:'Example',direction:'upside',
   observedAt:'2026-10-15T08:00:00Z',receivedAt:'2026-10-15T08:05:00Z',latency:'delayed-intraday',
   excessMovePct:3,robustZ:4,volumeRatio:2,reason:'Dated movement',
 }]}/>);
 expect(screen.queryByText('News also present')).toBeNull();
 expect(screen.getByText('No verified explanation')).toBeTruthy();
 expect(screen.getByText(ok?/No timely verified news/:/News retrieval failed/)).toBeTruthy();
});

test('the home distinguishes unconfirmed accounts from no review and keeps tools in separate views', async () => {
  const snapshot={...saved,tradeDate:'2026-10-13',expectedPriceDate:'2026-10-12',
    digestRecords:saved.digestRecords.map(record=>({...record,priceDate:'2026-10-11'}))};
  const payload={snapshot,freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/portfolio'
    ?buildPortfolioBook([],[]):url==='/api/copilot'?{messages:[],decisions:[]}:payload)));
  render(<ActionCockpit dashboard={payload}/>);
  expect(await screen.findByText('Complete account setup')).toBeTruthy();
  expect(screen.queryByText('0 company decisions pending')).toBeNull();
  expect(screen.queryByRole('complementary',{name:'TASI copilot'})).toBeNull();
  expect(screen.queryByRole('region',{name:'Delayed market pulse'})).toBeNull();
  await userEvent.click(screen.getByRole('link',{name:'Research'}));
  expect(window.location.search).toBe('?view=research');
  const watchlist=screen.getByRole('region',{name:'Your watchlist'});
  expect(within(watchlist).getAllByText('Stale quote').length).toBeGreaterThan(0);
  expect(within(watchlist).queryByRole('progressbar')).toBeNull();
  await userEvent.click(screen.getByRole('link',{name:'Assistant'}));
  expect(screen.getByRole('complementary',{name:'TASI copilot'})).toBeTruthy();
  await userEvent.click(screen.getByRole('link',{name:'Portfolio'}));
  await userEvent.selectOptions(screen.getByLabelText('View account'),'al_rajhi');
  expect(screen.getByLabelText('Amount (SAR)')).toBeTruthy();
});

test('a deep link opens the requested tool and browser Back restores the prior view', async () => {
  window.history.replaceState({}, '', '/?view=research');
  const payload={snapshot:saved,freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(payload)));
  render(<ActionCockpit dashboard={payload}/>);
  expect(await screen.findByRole('region',{name:'Your watchlist'})).toBeTruthy();
  await userEvent.click(screen.getByRole('link',{name:'Assistant'}));
  window.history.replaceState({}, '', '/?view=research');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(await screen.findByRole('region',{name:'Your watchlist'})).toBeTruthy();
});

test('a failed account fetch never labels legacy positions as confirmed broker holdings', async () => {
  const payload={snapshot:saved,freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/portfolio'
    ?Response.json({error:'unavailable'},{status:503}):Response.json(payload)));
  render(<ActionCockpit dashboard={payload}/>);
  expect(await screen.findByText(/Live portfolio ledger is unavailable/)).toBeTruthy();
  expect(screen.queryByText('Confirmed holdings')).toBeNull();
  expect(screen.getByText('Unassigned holdings')).toBeTruthy();
  expect(screen.getByText(/Saved holdings are unassigned legacy data/)).toBeTruthy();
});

test('evidence review exposes labeled fields instead of requiring raw JSON', async () => {
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({announcements:[]})));
  render(<EvidenceReviewForm/>);
  expect(screen.queryByLabelText('Reviewed evidence JSON')).toBeNull();
  expect(screen.getByLabelText('Company name')).toBeTruthy();
  expect(screen.getByLabelText('Official source URL')).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText('Company type'),'bank');
  expect(screen.getByLabelText('Capital adequacy pct · current value')).toBeTruthy();
});

test('an unavailable screening source is distinguished from a valid empty shortlist', async () => {
  const payload={snapshot:{...saved,qualified:[],indexUnavailable:true},freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(payload)));
  render(<ActionCockpit dashboard={payload}/>);
  await userEvent.click(screen.getByRole('link',{name:'Research'}));
  expect(screen.getByText(/Screening unavailable/)).toBeTruthy();
  expect(screen.queryByText(/No scanner candidate met/)).toBeNull();
});

test('reviewed evidence preserves Riyadh source times and the required metrics through a failed save and retry', async () => {
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-14T00:00:00Z'));
  let submitted:ReturnType<typeof validateEvidenceRecord>|null=null;
  const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
    if(url==='/api/evidence/queue')return Response.json({announcements:[]});
    try {submitted=validateEvidenceRecord(JSON.parse(String(init?.body)));return Response.json({revisionId:'test-revision'});}
    catch(error){return Response.json({error:error instanceof Error?error.message:'invalid evidence'},{status:400});}
  });
  vi.stubGlobal('fetch',fetcher);
  render(<EvidenceReviewForm/>);
  const fill=(name:string,value:string)=>fireEvent.change(screen.getByLabelText(name),{target:{value}});
  fill('Stock code','2320');fill('Company name','Example company');fill('Sector','Industrials');
  fill('Report period','2026 H1');fill('Official source URL','https://untrusted.example/source');
  fill('Published time (Riyadh)','2026-10-12T08:00');fill('Retrieved time (Riyadh)','2026-10-12T09:00');
  fill('Review notes','Reviewed against the original report.');
  for(const key of evidenceMetricFields('operating')) {
    const title=key.charAt(0).toUpperCase()+key.slice(1).replaceAll('_',' ');
    fill(`${title} · current value`,'20');fill(`${title} · prior value`,'19');
    fill(`${title} · reviewed grade`,'2');fill(`${title} · explanation`,'Source comparison reviewed.');
  }
  await userEvent.click(screen.getByRole('button',{name:'Save reviewed evidence'}));
  expect(await screen.findByText(/allowed official source/)).toBeTruthy();
  expect((screen.getByLabelText('Company name') as HTMLInputElement).value).toBe('Example company');
  fill('Official source URL','https://www.saudiexchange.sa/wps/issuer-announcements-details/test');
  await userEvent.click(screen.getByRole('button',{name:'Save reviewed evidence'}));
  expect(await screen.findByText(/Evidence revision saved/)).toBeTruthy();
  expect(submitted).toMatchObject({symbol:'2320',publishedAt:'2026-10-12T05:00:00.000Z',retrievedAt:'2026-10-12T06:00:00.000Z'});
},15000);
