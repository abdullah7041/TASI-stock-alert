import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ActionCockpit } from '@/app/components/ActionCockpit';
import type { DashboardPayload } from '@/app/lib/dashboard-types';
import fixture from '../fixtures/friendly-dashboard.json';
import {savedPortfolio} from '@/app/lib/portfolio-core.mjs';
const history=savedPortfolio([{operationId:'open',kind:'opening_balance',cashSar:fixture.portfolio.cashSar,confirmedAt:fixture.portfolio.confirmedAt},...fixture.portfolio.holdings.map(h=>({operationId:`position:${h.code}`,kind:'opening_position' as const,code:h.code,name:h.name,shares:h.shares,priceSar:h.avgCostSar,confirmedAt:fixture.portfolio.confirmedAt}))]);
const saved={...fixture,portfolio:{...fixture.portfolio,savedPortfolio:history,policyStatus:'unconfigured' as const}};

const payload = { snapshot: saved, freshness:'current', alerts:[] } as unknown as DashboardPayload;
afterEach(()=>{ cleanup();vi.unstubAllGlobals();window.history.replaceState({},'', '/'); });
function start(){vi.stubGlobal('fetch',vi.fn(async()=>Response.json(payload)));return render(<ActionCockpit dashboard={payload}/>);}
test('all holdings are visible on home, details and diagnostics stay one click away',async()=>{
  start();
  const holdings=screen.getByRole('region',{name:'My holdings'});
  expect(within(holdings).getByRole('button',{name:/EIC/})).toBeTruthy();
  expect(within(holdings).getByRole('button',{name:/Al-Babtain/})).toBeTruthy();
  expect(within(holdings).getByRole('button',{name:/Rasan/})).toBeTruthy();
  expect(screen.queryByText(/Everything else/)).toBeNull();
  expect(screen.queryByText(/no known provider/)).toBeNull();
  await userEvent.click(within(holdings).getByRole('button',{name:/EIC/}));
  const dialog=screen.getByRole('dialog');
  expect(within(dialog).getByRole('img',{name:/3-month price/})).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(screen.getByRole('button',{name:/Data status/}));
  expect(screen.getByRole('dialog').textContent).toMatch(/no known provider/);
}, 15_000);
test('the owner cockpit shows saved holdings instead of an older snapshot',async()=>{
  const live=savedPortfolio([{operationId:'open',kind:'opening_balance',cashSar:42.15,confirmedAt:'2026-09-07T10:00:00Z'},
    {operationId:'position',kind:'opening_position',code:'8313',name:'Rasan',shares:3,confirmedAt:'2026-09-07T10:00:00Z'}]);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/portfolio'?live:payload)));
  render(<ActionCockpit dashboard={payload}/>);
  await screen.findByText(/42.15 SAR recorded cash/);
  const holdings=screen.getByRole('region',{name:'My holdings'});
  expect(within(holdings).queryByRole('button',{name:/View EIC details/})).toBeNull();
  expect(within(holdings).getByRole('button',{name:/View Rasan details/})).toBeTruthy();
});
test('saved records remain usable when the daily snapshot is unavailable',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/portfolio'?Response.json(history):Response.json({error:'snapshot unavailable'},{status:502})));
  render(<ActionCockpit dashboard={null}/>);
  expect(await screen.findByRole('region',{name:'Saved portfolio'})).toBeTruthy();
  expect(screen.getByText('No verified daily snapshot is available.')).toBeTruthy();
  expect(screen.getByLabelText('Activity')).toBeTruthy();
});
test('a failed refresh retains the saved portfolio and its original date',async()=>{
  let failed=false;
  const live=savedPortfolio([{operationId:'open',kind:'opening_balance',cashSar:300,confirmedAt:'2026-10-01T08:00:00Z'}]);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/portfolio'?Response.json(failed?{error:'unavailable'}:live,{status:failed?503:200}):Response.json(payload)));
  render(<ActionCockpit dashboard={payload}/>);
  await userEvent.click(screen.getByRole('link',{name:'Portfolio'}));
  const records=await screen.findByRole('region',{name:'Saved portfolio'});
  expect(within(records).getByText('300.00 SAR recorded cash')).toBeTruthy();
  failed=true;await userEvent.click(screen.getByRole('button',{name:'Refresh cockpit'}));
  await screen.findByText(/Live portfolio ledger is unavailable/);
  expect(within(records).getByText('300.00 SAR recorded cash')).toBeTruthy();
  expect(within(records).getByText(/Last recorded:.*1 Oct 2026/)).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Preview record'})).toBeNull();
});
test('a malformed refresh cannot replace the last valid portfolio',async()=>{
  let broken=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/portfolio'?(broken?{schemaVersion:3,events:[],view:{cashSar:999}}:history):payload)));
  render(<ActionCockpit dashboard={payload}/>);
  await userEvent.click(screen.getByRole('link',{name:'Portfolio'}));
  await screen.findByRole('button',{name:'Preview record'});
  broken=true;await userEvent.click(screen.getByRole('button',{name:'Refresh cockpit'}));
  await screen.findByText(/Live portfolio ledger is unavailable/);
  expect(screen.getByRole('button',{name:/View EIC details/})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Preview record'})).toBeNull();
});
test('unavailable checks are explicit and market date differs from generated time',()=>{
  start();
  expect(screen.getByText('Some checks unavailable')).toBeTruthy();
  expect(screen.getByText(/Daily snapshot for/)).toBeTruthy();
  expect(screen.getByText(/Quotes dated/)).toBeTruthy();
  expect(screen.queryByText(/Market observed/)).toBeNull();
});

test('labels the snapshot date, previous-close price date, and action count separately',()=>{
  const dated = structuredClone(saved) as typeof saved;
  dated.tradeDate = '2026-09-07';
  dated.digestRecords = dated.digestRecords.map((record) => ({ ...record, priceDate: '2026-09-06' }));
  const datedPayload = { snapshot: dated, freshness:'current', alerts:[] } as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(datedPayload)));
  render(<ActionCockpit dashboard={datedPayload}/>);

  expect(screen.getByText('Daily snapshot for 2026-09-07')).toBeTruthy();
  expect(screen.getByText(/Quotes dated 2026-09-06/)).toBeTruthy();
  const summary=screen.getByText('Saved holdings').parentElement!;
  expect(summary.textContent).toContain('3');
  expect(screen.getAllByRole('button',{name:/View .* details/})).toHaveLength(3);
});

test('labels mixed holding quote dates as a range instead of one false previous close',()=>{
  const base=structuredClone(saved);
  const mixed={...base,tradeDate:'2026-09-08',digestRecords:base.digestRecords.map((record,index)=>({
    ...record,priceDate:index===0?'2026-09-06':'2026-09-07',
  }))};
  const mixedPayload={snapshot:mixed,freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(mixedPayload)));
  render(<ActionCockpit dashboard={mixedPayload}/>);

  expect(screen.getByText(/Quotes dated 2026-09-06 to 2026-09-07/)).toBeTruthy();
});

test('manual refresh reports that the saved artifact is unchanged',async()=>{
  start();
  await userEvent.click(screen.getByRole('button',{name:'Refresh cockpit'}));
  expect(await screen.findByText('Already showing the latest saved daily snapshot.')).toBeTruthy();
});

test('manual refresh reports an updated artifact',async()=>{
  const updated = structuredClone(saved) as typeof saved;
  updated.artifactId = 'sha256:updated-artifact';
  updated.tradeDate = '2026-09-07';
  const updatedPayload = { snapshot:updated, freshness:'current', alerts:[] } as unknown as DashboardPayload;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(payload))
    .mockResolvedValueOnce(Response.json(updatedPayload));
  vi.stubGlobal('fetch',(url: string)=>url==='/api/copilot'?Promise.resolve(Response.json({messages:[],decisions:[]})):url==='/api/portfolio'?Promise.resolve(Response.error()):fetchMock());
  render(<ActionCockpit dashboard={payload}/>);

  await screen.findByRole('button',{name:'Refresh cockpit'});
  await userEvent.click(screen.getByRole('button',{name:'Refresh cockpit'}));
  expect(await screen.findByText('Updated to daily snapshot for 2026-09-07.')).toBeTruthy();
});

test('manual refresh reports when the latest saved artifact is stale',async()=>{
  const stalePayload = { snapshot:saved, freshness:'stale', alerts:[] } as unknown as DashboardPayload;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json(payload))
    .mockResolvedValueOnce(Response.json(stalePayload));
  vi.stubGlobal('fetch',(url: string)=>url==='/api/copilot'?Promise.resolve(Response.json({messages:[],decisions:[]})):url==='/api/portfolio'?Promise.resolve(Response.error()):fetchMock());
  render(<ActionCockpit dashboard={payload}/>);

  await screen.findByRole('button',{name:'Refresh cockpit'});
  await userEvent.click(screen.getByRole('button',{name:'Refresh cockpit'}));
  expect(await screen.findByText(`Latest saved snapshot is still stale (${saved.tradeDate}).`)).toBeTruthy();
});

test('stock details disclose the safe AI provider failure reason',async()=>{
  start();
  await userEvent.click(screen.getByRole('button',{name:/View EIC details/}));
  expect(screen.getByRole('dialog').textContent).toContain('AI interpretation unavailable: no known provider in TASI_LLM_PROVIDERS (empty)');
});

test('optional AI unavailability does not downgrade complete deterministic holding checks',()=>{
  const base=structuredClone(saved);
  const complete={...base,warnings:[],digestRecords:base.digestRecords.map((record)=>record.kind==='holding'?{
      ...record,
      rules:[
        {rule:'stop_level',available:true,passed:false,plain:'Protective stop not crossed.'},
        {rule:'trim_level',available:true,passed:false,plain:'Trim level not crossed.'},
        {rule:'target_level',available:true,passed:false,plain:'Profit target not crossed.'},
      ],
    }:record)};
  const completePayload={snapshot:complete,freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(completePayload)));
  render(<ActionCockpit dashboard={completePayload}/>);

  expect(screen.getByText('Company reviews are pending')).toBeTruthy();
  expect(screen.queryByText('Some checks unavailable')).toBeNull();
});

test('home, watchlist, and view-all controls expose every navigation state',async()=>{
  const expanded=structuredClone(saved) as typeof saved;
  expanded.qualified=[...expanded.qualified,
    {code:'9998',name:'Candidate Four',relativeStrengthPct:7.1,squeeze:true,conditionsMet:2},
    {code:'9999',name:'Candidate Five',relativeStrengthPct:6.8,squeeze:false,conditionsMet:2},
  ];
  const expandedPayload={snapshot:expanded,freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(expandedPayload)));
  render(<ActionCockpit dashboard={expandedPayload}/>);

  expect(screen.getByRole('link',{name:'TASI home'}).getAttribute('href')).toBe('/');
  await userEvent.click(screen.getByRole('link',{name:'Research'}));
  await userEvent.click(screen.getByRole('button',{name:'View all (5)'}));
  expect(screen.getAllByRole('button',{name:/Explore company/})).toHaveLength(5);
  await userEvent.click(screen.getByRole('button',{name:'Show less'}));
  expect(screen.getAllByRole('button',{name:/Explore company/})).toHaveLength(3);

  const watchlist=screen.getByRole('region',{name:'Your watchlist'});
  await userEvent.click(within(watchlist).getByRole('button',{name:/View Avalon Pharma details/}));
  expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Avalon Pharma');
});

test('Data status closes by button and Escape, traps focus, and restores its trigger',async()=>{
  start();
  const trigger=screen.getByRole('button',{name:/Data status/});
  trigger.focus();
  await userEvent.click(trigger);
  const close=screen.getByRole('button',{name:'Close details'});
  expect(document.activeElement).toBe(close);
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Refresh data'}));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);

  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('button',{name:'Close details'}));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test.each(['EIC','Al-Babtain','Rasan'])('opens %s holding details with a quote date',async(name)=>{
  start();
  await userEvent.click(screen.getByRole('button',{name:new RegExp(`View ${name} details`)}));
  const dialog=screen.getByRole('dialog',{name});
  expect(dialog.textContent).toContain('Price date:');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('holding details expose only safe HTTPS source links',async()=>{
  const base=structuredClone(saved);
  const sourced={...base,digestRecords:base.digestRecords.map((record,index)=>index===0?{
    ...record,news:{...record.news,headlines:[
      {title:'Official disclosure',link:'https://www.saudiexchange.sa/example',published:'2026-09-06'},
      {title:'Unsafe source',link:'http://example.test/unsafe',published:'2026-09-06'},
    ]},
  }:record)};
  const sourcedPayload={snapshot:sourced,freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(sourcedPayload)));
  render(<ActionCockpit dashboard={sourcedPayload}/>);

  await userEvent.click(screen.getByRole('button',{name:/View EIC details/}));
  expect(screen.getByRole('link',{name:/Official disclosure/}).getAttribute('href')).toBe('https://www.saudiexchange.sa/example');
  expect(screen.queryByRole('link',{name:/Unsafe source/})).toBeNull();
});

test('keeps verified events separate from unexplained anomalies in Research and chat in Assistant',async()=>{
  const base=structuredClone(saved);
  const headline={title:'Insurance investment-rule draft published',link:'https://www.ia.gov.sa/regulations/investment-draft',published:'2026-09-16T06:08:00Z'};
  const evidence={...base,tradeDate:'2026-09-16',asOf:'2026-09-16T11:00:00Z',expectedPriceDate:'2026-09-15',digestRecords:base.digestRecords.map((record,index)=>index<2?{
    ...record,news:{ok:true,status:'available' as const,headlines:[headline]},
  }:record)};
  const evidencePayload={snapshot:evidence,freshness:'current',alerts:[{
    alertId:'alert-unexplained',code:'9997',name:'Example Co',direction:'downside',
    observedAt:'2026-09-16T08:20:00Z',receivedAt:'2026-09-16T08:25:00Z',latency:'delayed-intraday',
    excessMovePct:-4.7,robustZ:-4.6,volumeRatio:1.5,reason:'Delayed unusual movement.',
  }]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(evidencePayload)));
  render(<ActionCockpit dashboard={evidencePayload}/>);

  expect(screen.getByRole('region',{name:'Daily freshness'})).toBeTruthy();
  await userEvent.click(screen.getByRole('link',{name:'Research'}));
  const intelligence=screen.getByRole('region',{name:'Market intelligence'});
  expect(within(intelligence).getByText(/causation is not proven/i)).toBeTruthy();
  expect(within(intelligence).getByText('Example Co')).toBeTruthy();
  expect(within(intelligence).getByText(/No timely verified news/i)).toBeTruthy();
  expect(screen.queryByRole('complementary',{name:'TASI copilot'})).toBeNull();
  await userEvent.click(screen.getByRole('link',{name:'Assistant'}));
  expect(screen.getByRole('complementary',{name:'TASI copilot'})).toBeTruthy();
});

test('keeps available delayed quote observations in Research with their original times',async()=>{
  const pulsePayload={...payload,marketPulse:{
    schemaVersion:1,artifactKind:'market-pulse',artifactId:`sha256:${'a'.repeat(64)}`,
    asOf:'2026-09-16T07:10:00Z',dataStatus:'delayed-intraday',source:'yahoo',status:'available',
    requested:['1303'],errors:[],quotes:[{
      code:'1303',name:'EIC',price:14.73,changePct:1.3067,sessionVolume:250,
      observedAt:'2026-09-16T07:05:00Z',latency:'delayed-intraday',
    }],
  }} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(pulsePayload)));
  render(<ActionCockpit dashboard={pulsePayload}/>);

  expect(screen.queryByRole('region',{name:'Delayed market pulse'})).toBeNull();
  await userEvent.click(screen.getByRole('link',{name:'Research'}));
  await userEvent.click(screen.getByText('Saved delayed quote observations'));
  const pulse=screen.getByRole('region',{name:'Delayed market pulse'});
  expect(within(pulse).getByText('EIC')).toBeTruthy();
  expect(within(pulse).getByText('14.73 SAR')).toBeTruthy();
  expect(within(pulse).getByText(/Observed .*Asia\/Riyadh/i)).toBeTruthy();
  expect(within(pulse).getByText(/Delayed quote observations/i)).toBeTruthy();
});
