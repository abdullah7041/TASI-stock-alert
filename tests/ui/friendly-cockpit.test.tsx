import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ActionCockpit } from '@/app/components/ActionCockpit';
import type { DashboardPayload } from '@/app/lib/dashboard-types';
import saved from '../fixtures/friendly-dashboard.json';
import {buildPortfolioBook} from '@/app/lib/portfolio-core.mjs';
import type {AccountRecord} from '@/app/lib/evidence-types';

const payload = { snapshot: saved, freshness:'current', alerts:[] } as unknown as DashboardPayload;
afterEach(()=>{ cleanup();vi.unstubAllGlobals(); });
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
test('the owner cockpit shows current ledger holdings after a fully recorded sale',async()=>{
  const live=buildPortfolioBook([{accountId:'al_rajhi',operationId:'open',revision:1,recordedAt:'2026-09-07T10:00:00Z',kind:'event',payload:{kind:'opening_balance',cashSar:42.15,holdings:[{code:'2320',name:'Al-Babtain',shares:2},{code:'8313',name:'Rasan',shares:3}],occurredAt:'2026-09-07T10:00:00Z',provenance:{source:'manual'}}} as AccountRecord],[]);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url==='/api/portfolio'?live:payload)));
  render(<ActionCockpit dashboard={payload}/>);
  const holdings=screen.getByRole('region',{name:'My holdings'});
  await screen.findByRole('region',{name:'Broker accounts'});
  await userEvent.selectOptions(screen.getByLabelText('View account'),'al_rajhi');
  expect(await within(holdings).findByText(/42.15 SAR cash/)).toBeTruthy();
  expect(within(holdings).queryByRole('button',{name:/View EIC details/})).toBeNull();
  expect(within(holdings).getByRole('button',{name:/View Rasan details/})).toBeTruthy();
});

test('account records remain usable when the daily snapshot is unavailable',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/portfolio'?Response.json(buildPortfolioBook([],[])):Response.json({error:'snapshot unavailable'},{status:502})));
  render(<ActionCockpit dashboard={null}/>);
  await screen.findByRole('region',{name:'Broker accounts'});
  expect(screen.getByText('No verified daily snapshot is available.')).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText('View account'),'al_ahli');
  expect(screen.getByLabelText('Amount (SAR)')).toBeTruthy();
});

test('a failed refresh retains the last account book and its confirmation time',async()=>{
  let failed=false;
  const live=buildPortfolioBook([{accountId:'al_rajhi',operationId:'open',revision:1,recordedAt:'2026-10-08T08:00:00Z',kind:'event',payload:{kind:'opening_balance',cashSar:300,holdings:[],occurredAt:'2026-10-01T08:00:00Z',provenance:{source:'manual'}}} as AccountRecord],[]);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url==='/api/portfolio'?Response.json(failed?{error:'unavailable'}:live,{status:failed?503:200}):Response.json(payload)));
  render(<ActionCockpit dashboard={payload}/>);
  const accounts=await screen.findByRole('region',{name:'Broker accounts'});
  expect(within(accounts).getByText('300.00 SAR cash')).toBeTruthy();
  failed=true;await userEvent.click(screen.getByRole('button',{name:'Refresh cockpit'}));
  await screen.findByText(/Live portfolio ledger is unavailable/);
  expect(within(accounts).getByText('300.00 SAR cash')).toBeTruthy();
  expect(within(accounts).getByText(/Confirmed: 2026-10-08T08:00:00Z/)).toBeTruthy();
});
test('unavailable checks are explicit and market date differs from generated time',()=>{
  start();
  expect(screen.getByText('Some checks unavailable')).toBeTruthy();
  expect(screen.getByText(/Daily snapshot for/)).toBeTruthy();
  expect(screen.getByText(/Prices from previous close/)).toBeTruthy();
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
  expect(screen.getByText(/Prices from previous close 2026-09-06/)).toBeTruthy();
  const summary=screen.getByText('holdings need action').parentElement!;
  expect(summary.textContent).toContain('0holdings need action');
  expect(screen.getByText('3 holdings tracked')).toBeTruthy();
});

test('labels mixed holding quote dates as a range instead of one false previous close',()=>{
  const base=structuredClone(saved);
  const mixed={...base,tradeDate:'2026-09-08',digestRecords:base.digestRecords.map((record,index)=>({
    ...record,priceDate:index===0?'2026-09-06':'2026-09-07',
  }))};
  const mixedPayload={snapshot:mixed,freshness:'current',alerts:[]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(mixedPayload)));
  render(<ActionCockpit dashboard={mixedPayload}/>);

  expect(screen.getByText(/Latest available prices dated 2026-09-06 to 2026-09-07/)).toBeTruthy();
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

  expect(screen.getByText('No holding needs a rule-based action.')).toBeTruthy();
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
  await userEvent.click(screen.getByRole('button',{name:'View all (5)'}));
  expect(screen.getAllByRole('button',{name:/Explore company/})).toHaveLength(5);
  await userEvent.click(screen.getByRole('button',{name:'Show less'}));
  expect(screen.getAllByRole('button',{name:/Explore company/})).toHaveLength(3);

  await userEvent.click(screen.getByRole('button',{name:/Your watchlist/}));
  expect(screen.getByRole('dialog').textContent).toContain('Entry conditions for the companies you follow');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:/View Avalon Pharma details/}));
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
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Save reviewed evidence'}));
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

test('shows freshness before verified events and unexplained anomalies with a persistent copilot rail',()=>{
  const base=structuredClone(saved);
  const headline={title:'Insurance investment-rule draft published',link:'https://www.ia.gov.sa/regulations/investment-draft',published:'2026-09-16T06:08:00Z'};
  const evidence={...base,digestRecords:base.digestRecords.map((record,index)=>index<2?{
    ...record,news:{ok:true,status:'available' as const,headlines:[headline]},
  }:record)};
  const evidencePayload={snapshot:evidence,freshness:'current',alerts:[{
    alertId:'alert-unexplained',code:'9997',name:'Example Co',direction:'downside',
    observedAt:'2026-09-16T08:20:00Z',receivedAt:'2026-09-16T08:25:00Z',latency:'delayed-intraday',
    excessMovePct:-4.7,robustZ:-4.6,volumeRatio:1.5,reason:'Delayed unusual movement.',
  }]} as unknown as DashboardPayload;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json(evidencePayload)));
  render(<ActionCockpit dashboard={evidencePayload}/>);

  const freshness=screen.getByRole('region',{name:'Daily freshness'});
  const intelligence=screen.getByRole('region',{name:'Market intelligence'});
  expect(freshness.compareDocumentPosition(intelligence)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(intelligence).getByText(/causation is not proven/i)).toBeTruthy();
  expect(within(intelligence).getByText('Example Co')).toBeTruthy();
  expect(within(intelligence).getByText(/No timely verified news/i)).toBeTruthy();
  expect(screen.getByRole('complementary',{name:'TASI copilot'})).toBeTruthy();
  expect(screen.getByRole('region',{name:'My holdings'})).toBeTruthy();
});

test('shows the delayed market pulse with its source observation time',()=>{
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

  const pulse=screen.getByRole('region',{name:'Delayed market pulse'});
  expect(within(pulse).getByText('EIC')).toBeTruthy();
  expect(within(pulse).getByText('14.73 SAR')).toBeTruthy();
  expect(within(pulse).getByText(/Observed .*Asia\/Riyadh/i)).toBeTruthy();
  expect(within(pulse).getByText(/5-minute delayed quote/i)).toBeTruthy();
});
