"use client";
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candidate, DashboardPayload } from '@/app/lib/dashboard-types';
import type { SavedPortfolio } from '@/app/lib/evidence-types';
import { savedPortfolio, parseSavedPortfolio, parsePortfolioBook, PortfolioConflict } from '@/app/lib/portfolio-core.mjs';
import { buildDecisionView } from '@/app/lib/decision-view.mjs';
import type { StockDecision } from '@/app/lib/decision-view.mjs';
import { SavedPortfolioPanel, PortfolioActivityForm } from './SavedPortfolio';
import { AlertBoard, formatCockpitTimestamp } from './AlertBoard';
import { ResearchWorkspace } from './ResearchWorkspace';
import { DetailDialog, StockDetails } from './CockpitDetails';
import { IntelligenceBoard } from './IntelligenceBoard';
import { MarketPulse } from './MarketPulse';
import { CopilotRail } from './CopilotRail';
import { EvidenceReviewForm } from './EvidenceReviewForm';
import styles from './FriendlyCockpit.module.css';

type CockpitView = 'overview' | 'portfolio' | 'research' | 'assistant';
const views: Array<{id:CockpitView;label:string}> = [
  {id:'overview',label:'Overview'}, {id:'portfolio',label:'Portfolio'},
  {id:'research',label:'Research'}, {id:'assistant',label:'Assistant'},
];
const money = (n:number|null) => n===null ? 'Unconfirmed' : `${n.toLocaleString('en-SA',{minimumFractionDigits:2,maximumFractionDigits:2})} SAR`;
const signed = (n:number|null) => n===null ? '—' : `${n>0?'+':''}${n.toFixed(1)}%`;
function urlView():CockpitView {
  const value = new URLSearchParams(window.location.search).get('view');
  return views.some(view=>view.id===value) ? value as CockpitView : 'overview';
}

function StockCard({stock,onOpen}:{stock:StockDecision;onOpen:()=>void}) {
  return <button className={styles.stockCard} onClick={onOpen} aria-label={`View ${stock.name} details`}
    data-tone={stock.unavailable?'muted':stock.needsAttention?'warning':'normal'}>
    <span className={styles.cardHeader}>
      <span className={styles.monogram} aria-hidden="true">{stock.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</span>
      <span className={styles.stockIdentity}><strong className={styles.stockName}>{stock.name}</strong>
        <span className={styles.code}>{stock.code}{stock.shares!==null?` · ${stock.shares} shares`:''}</span></span>
      <span className={styles.cardArrow} aria-hidden="true">↗</span>
    </span>
    <span className={styles.priceRow}><strong>{stock.price===null?'Price unavailable':money(stock.price)}</strong>
      <span data-direction={(stock.dailyChange??0)<0?'down':'up'}>{signed(stock.dailyChange)}<small>dated session</small></span></span>
    <span className={styles.cardMeta}><span className={styles.pill}
      data-tone={stock.quoteState==='current'?'green':'warning'}>
      {stock.quoteState==='stale'?'Stale quote':stock.quoteState==='unavailable'?'Quote unavailable':stock.label}</span>
      {stock.owned&&stock.pnl!==null&&<span className={styles.pnl}>P/L <strong>{signed(stock.pnl)}</strong></span>}</span>
    <span className={styles.cardReason}>{stock.reason}</span>
    {!stock.owned&&stock.conditionsTotal!==null&&<span className={styles.conditions}>
      <progress value={stock.conditionsMet??0} max={stock.conditionsTotal||1}/>
      {stock.conditionsMet??0} of {stock.conditionsTotal} observed conditions</span>}
    <span className={styles.cardFooter}><span className={styles.priceDate}>Quote date {stock.priceDate??'unavailable'}</span>
      <span className={styles.cardLink}>View evidence</span></span>
  </button>;
}

export function ActionCockpit({dashboard}:{dashboard:DashboardPayload|null}) {
  const [data,setData]=useState(dashboard), [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const [refreshStatus,setRefreshStatus]=useState('');
  const [portfolio,setPortfolio]=useState<SavedPortfolio|null>(null), [ledgerError,setLedgerError]=useState(false);
  const [ledgerConflict,setLedgerConflict]=useState<string|null>(null);
  const [viewId,setViewId]=useState<CockpitView>('overview');
  const [selected,setSelected]=useState<StockDecision|null>(null), [panel,setPanel]=useState<'status'|'trade'|null>(null);
  const [candidate,setCandidate]=useState<Candidate|null>(null), [all,setAll]=useState(false);
  const [actionStatus,setActionStatus]=useState(''), [actionBusy,setActionBusy]=useState(false);
  const dataRef=useRef(dashboard), refreshing=useRef(false);

  const refresh=useCallback(async(announce=false)=>{
    if(refreshing.current)return;
    refreshing.current=true;setBusy(true);
    if(announce)setRefreshStatus('Checking for the latest saved snapshot…');
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),15_000);
    try {
      const [ledgerResult,dashboardResult]=await Promise.allSettled([
        fetch('/api/portfolio',{cache:'no-store',signal:controller.signal}).then(async r=>{
          if(r.status===409)throw new PortfolioConflict('Saved records require reconciliation before using one portfolio.');
          if(!r.ok)throw new Error('Ledger unavailable');return parseSavedPortfolio(await r.json());
        }),
        fetch('/api/dashboard',{cache:'no-store',signal:controller.signal}).then(async r=>{
          const value=await r.json();if(!r.ok||!value.snapshot)throw new Error('Snapshot unavailable');return value as DashboardPayload;
        }),
      ]);
      if(ledgerResult.status==='fulfilled') {
        const next=ledgerResult.value;
        setPortfolio(next);
        setLedgerConflict(null);
        setLedgerError(false);
      } else {setLedgerError(true);if(ledgerResult.reason instanceof PortfolioConflict){setLedgerConflict(ledgerResult.reason.message);setPortfolio(null);}}
      if(dashboardResult.status==='rejected')throw new Error('Snapshot unavailable');
      const next=dashboardResult.value, previous=dataRef.current?.snapshot;
      const priorKey=previous?.schemaVersion===3?previous.artifactId:previous?`${previous.tradeDate}:${previous.asOf}`:null;
      const nextKey=next.snapshot.schemaVersion===3?next.snapshot.artifactId:`${next.snapshot.tradeDate}:${next.snapshot.asOf}`;
      dataRef.current=next;setData(next);setError(null);
      if(announce)setRefreshStatus(next.freshness==='stale'
        ?`Latest saved snapshot is still stale (${next.snapshot.tradeDate}).`
        :priorKey===nextKey?'Already showing the latest saved daily snapshot.':`Updated to daily snapshot for ${next.snapshot.tradeDate}.`);
    } catch {
      setError('Refresh failed. Showing the last good view. Try again shortly.');
      if(announce)setRefreshStatus('Refresh failed; the last good snapshot remains visible.');
    } finally {clearTimeout(timeout);refreshing.current=false;setBusy(false);}
  },[]);

  useEffect(()=>{
    const initial=setTimeout(()=>{setViewId(urlView());void refresh();},0);
    const visible=()=>{if(document.visibilityState==='visible')void refresh();};
    const back=()=>{setViewId(urlView());setSelected(null);setPanel(null);};
    const interval=setInterval(visible,60_000);
    document.addEventListener('visibilitychange',visible);window.addEventListener('popstate',back);
    return()=>{clearTimeout(initial);clearInterval(interval);document.removeEventListener('visibilitychange',visible);window.removeEventListener('popstate',back);};
  },[refresh]);
  function navigate(next:CockpitView) {
    const url=new URL(window.location.href);
    if(next==='overview')url.searchParams.delete('view');else url.searchParams.set('view',next);
    window.history.pushState({},'',url.pathname+url.search+url.hash);
    setViewId(next);setSelected(null);setPanel(null);
  }
  const close=()=>{setSelected(null);setPanel(null);};
  const header=<header className={styles.header}>
    <Link className={styles.brand} href="/" aria-label="TASI home"><span className={styles.logo} aria-hidden="true">↗</span>TASI<span>Portfolio cockpit</span></Link>
    <div className={styles.toolbar}><span className={styles.liveDot}>Delayed daily data</span>
      <button className={styles.secondaryButton} onClick={()=>setPanel('status')}>Data status</button>
      <button className={styles.iconButton} aria-label="Refresh cockpit" disabled={busy} onClick={()=>void refresh(true)}>{busy?'…':'↻'}</button></div>
  </header>;
  const navigation=<nav className={styles.navigation} aria-label="Main navigation">{views.map(view=>
    <a key={view.id} href={view.id==='overview'?'/':`/?view=${view.id}`} aria-current={viewId===view.id?'page':undefined}
      onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){event.preventDefault();navigate(view.id);}}}>{view.label}</a>)}</nav>;
  if(candidate)return <ResearchWorkspace candidate={candidate} onClose={()=>setCandidate(null)}/>;
  if(!data)return <main className={styles.page}>{header}{navigation}
    <section className={styles.empty}><h1>{error?'No verified daily snapshot is available.':'Loading the latest saved daily digest…'}</h1>
      {error&&<button className={styles.primaryButton} onClick={()=>void refresh(true)}>Try again</button>}</section>
    {ledgerError&&<p className={styles.notice} role="status">{ledgerConflict??'Portfolio refresh failed. Saved records may be stale.'}</p>}
    {portfolio&&viewId!=='assistant'&&<SavedPortfolioPanel portfolio={portfolio} onSaved={()=>void refresh()} readOnly={ledgerError}/>}
    {viewId==='assistant'&&<CopilotRail/>}
  </main>;

  const {snapshot,freshness}=data, v2=snapshot.schemaVersion===1?null:snapshot, v3=snapshot.schemaVersion===3?snapshot:null;
  let fallback:SavedPortfolio|null=null;
  if(!portfolio&&!ledgerConflict&&v2){try{
    const historical=v2.portfolio.accountBook?parsePortfolioBook(v2.portfolio.accountBook):null;
    if(!historical?.accounts.some(account=>account.records.length))fallback=v2.portfolio.savedPortfolio
      ?parseSavedPortfolio(v2.portfolio.savedPortfolio):historical?savedPortfolio(historical.legacy.events as SavedPortfolio['events']):null;
  }catch{/* Invalid saved history is unavailable. */}}
  const displayedPortfolio=portfolio??fallback;
  const livePortfolio={...(displayedPortfolio??savedPortfolio([])).view,confirmedAt:displayedPortfolio?.view.confirmedAt??snapshot.asOf};
  const view=buildDecisionView(snapshot,freshness,livePortfolio), candidates=all?view.candidates:view.candidates.slice(0,3);
  const policyPending=true;
  const statusWarnings=[...new Set(snapshot.warnings.filter(warning=>!/^Top 10 draft unavailable:/i.test(warning)))];
  const indexWarning=statusWarnings.some(warning=>/TASI index unavailable|Market regime unavailable:.*index/i.test(warning));
  const visibleWarnings=statusWarnings.filter(warning=>!/TASI index unavailable|Market regime unavailable:.*index/i.test(warning));
  if(indexWarning)visibleWarnings.unshift('TASI index unavailable; market regime and relative strength cannot be calculated.');
  const reviews=view.holdings.filter(stock=>stock.unavailable||stock.needsAttention);
  const quotes=[...view.holdings,...view.watchlist], staleCount=quotes.filter(stock=>stock.quoteState==='stale').length;
  const priceDateLabel=view.priceDates.length===0?'Quotes unavailable':view.priceDates.length===1
    ?`Quotes dated ${view.priceDates[0]}`:`Quotes dated ${view.priceDates[0]} to ${view.priceDates.at(-1)}`;
  // Older snapshots called a one-bar index available; keep its explicit source warning useful.
  const reportedIndexBars=/\bindex\b.*returned (\d+) usable bars/i.exec(snapshot.warnings.join('\n'));
  const screeningUnavailable=Boolean(v2?.indexUnavailable)
    ||(reportedIndexBars!==null&&Number(reportedIndexBars[1])<=60)
    ||snapshot.warnings.some(warning=>/scanner.*(failed|unavailable)/i.test(warning));
  const researchEnabled=freshness==='current'&&!screeningUnavailable&&import.meta.env.VITE_AGENT_ENABLED!=='false';
  const delivery=data.delivery, review=v3?.top10Review??(v2?.top10.status==='draft'?v2.top10:null);
  const sourceFailures=v3?.digestRecords.filter(record=>record.news?.ok===false||record.disclosures?.ok===false).length??0;
  const sourceStatuses=(['news','disclosures'] as const).map(field=>{
    const counts=new Map<string,number>();
    for(const record of v3?.digestRecords??[]){
      const source=record[field],items=field==='news'?record.news?.headlines:record.disclosures?.items;
      const state=!source||typeof source.ok!=='boolean'?'not collected':!source.ok?'failed':field==='news'&&record.news?.status==='partial'?'partial coverage':items?.length?'supplied content':'successful empty';
      counts.set(state,(counts.get(state)??0)+1);
    }
    return `${field==='news'?'News':'Filings'}: ${counts.size?[...counts].map(([state,count])=>`${count} ${state}`).join('; '):'collection status unavailable'}.`;
  });

  async function decide(decision:'approved'|'rejected') {
    if(!review?.entries.length||actionBusy)return;setActionBusy(true);setActionStatus('');
    try {
      const response=await fetch('/api/top10/approve',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({proposalId:review.proposalId,decision,decidedAt:new Date().toISOString()})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??'Could not save decision');
      setActionStatus(`Top 10 ${decision}.`);await refresh();
    } catch(e){setActionStatus(e instanceof Error?e.message:'Could not save decision');}
    finally{setActionBusy(false);}
  }
  const holdings=<section className={styles.section} aria-label="My holdings">
    <div className={styles.sectionHead}><h2>My holdings <span>{view.holdings.length}</span></h2>
      <div className={styles.toolbar}>{portfolio&&<span className={styles.cash}>{money(portfolio.view.cashSar)} recorded cash</span>}
        {portfolio?.eventCount&&!ledgerError&&
          <button className={styles.textButton} onClick={()=>setPanel('trade')}>Record a trade ↗</button>}</div></div>
    {view.holdings.length?<div className={styles.grid}>{view.holdings.map(stock=>
      <StockCard key={stock.code} stock={stock} onOpen={()=>setSelected(stock)}/>)}</div>:
      <div className={styles.empty}><h3>{portfolio?'No holdings in your saved portfolio.':'Saved holdings are unavailable.'}</h3>
        <p>Watchlist companies remain in Research.</p></div>}
    {!portfolio&&fallback&&<p className={styles.sectionNote}>Showing dated saved history. Refresh before recording activity.</p>}
  </section>;

  return <main className={styles.page}>{header}{navigation}
    {error&&<p className={styles.notice} role="status">{error}</p>}
    {ledgerError&&<p className={styles.notice} role="status">{ledgerConflict??'Live portfolio ledger is unavailable. Saved records retain their original dates; refresh before recording activity.'}</p>}
    {refreshStatus&&<p className={styles.refreshStatus} role="status" aria-live="polite">{refreshStatus}</p>}
    {viewId==='overview'&&<>
      <section className={styles.today} aria-label="Daily freshness">
        <div className={styles.briefing}><h1>Portfolio overview</h1>
          <p className={styles.takeaway}>{view.incomplete?'Some checks unavailable':
            policyPending?'Company reviews are pending':reviews.length?'Review the dated observations below':'Your daily check-in is ready'}</p>
          <p className={styles.muted}>Use the dated evidence to review your companies. No trade quantity is proposed.</p>
          <p className={styles.date}>Daily snapshot for {snapshot.tradeDate}</p>
          <p className={styles.date}>{priceDateLabel} · Saved {formatCockpitTimestamp(snapshot.asOf)}</p>
        </div>
        <div className={styles.briefAction}><button className={styles.primaryButton} onClick={()=>navigate('research')}>Review company evidence</button></div>
      </section>
      <div className={styles.metricGrid}>
        <article className={styles.metricCard}><span>Saved holdings</span><strong>{displayedPortfolio?view.holdings.length:'Unavailable'}</strong><small>{displayedPortfolio?.view.confirmedAt?`Recorded ${formatCockpitTimestamp(displayedPortfolio.view.confirmedAt)}`:'Waiting for saved records'}</small></article>
        <article className={styles.metricCard}><span>Recorded cash</span><strong>{money(displayedPortfolio?.view.cashSar??null)}</strong><small>Check your broker for current balances</small></article>
        <article className={styles.metricCard}><span>Quote coverage</span><strong>{staleCount?'Stale quotes':quotes.some(stock=>stock.quoteState==='unavailable')?'Partial data':quotes.length?'Dated daily quotes':'Unavailable'}</strong><small>{snapshot.expectedPriceDate?`Expected session ${snapshot.expectedPriceDate}`:'Check the date beside each company'}</small></article>
      </div>
      {freshness==='stale'&&<p className={styles.notice} aria-label="Stale data warning">The expected pre-open refresh did not arrive. This is the last successful daily snapshot; research is disabled.</p>}
      {freshness!=='stale'&&(staleCount>0||sourceFailures>0||statusWarnings.length>0)&&
        <p className={styles.notice} aria-label="Data quality warning">{staleCount?`${staleCount} quote(s) are older than the expected session. `:''}
          {sourceFailures?`Source retrieval failed for ${sourceFailures} stock(s). `:''}
          <button className={styles.textButton} onClick={()=>setPanel('status')}>Review data status</button></p>}
      <section className={styles.section} aria-label="Review items"><div className={styles.sectionHead}><h2>Needs review</h2>
        <button className={styles.textButton} onClick={()=>navigate('research')}>Open Research ↗</button></div>
        {reviews.length?<div className={styles.reviewList}>{reviews.map(stock=><button key={stock.code} onClick={()=>setSelected(stock)}>
            <strong>{stock.name}</strong><span>{stock.reason}</span><span>View evidence ↗</span></button>)}</div>:
          <p className={styles.sectionNote}>{policyPending?'Company assessments are pending. Review sources before reaching an investment conclusion.':
            view.incomplete?'Review coverage is incomplete; check source availability.':'No new review item in this dated snapshot.'}</p>}
      </section>
      {holdings}
    </>}
    {viewId==='portfolio'&&<><div className={styles.viewHeading}><h1>Portfolio</h1><p>Your saved holdings and completed activity.</p></div>
      {displayedPortfolio?<SavedPortfolioPanel portfolio={displayedPortfolio} onSaved={()=>void refresh()} readOnly={!portfolio||ledgerError}/>:
        <p className={styles.notice}>Saved records are unavailable. Refresh before recording activity.</p>}
      {holdings}</>}
    {viewId==='research'&&<><div className={styles.viewHeading}><h1>Research</h1><p>Follow your companies, review dated evidence, and explore screening ideas.</p></div>
      <section className={styles.section} aria-label="Your watchlist"><div className={styles.sectionHead}><h2>Your watchlist <span>{view.watchlist.length}</span></h2>
        <span className={styles.sectionNote}>Observations, not owned holdings</span></div>
        {view.watchlist.length?<div className={styles.grid}>{view.watchlist.map(stock=><StockCard key={stock.code} stock={stock} onOpen={()=>setSelected(stock)}/>)}</div>:
          <p className={styles.sectionNote}>No followed companies are present in this snapshot.</p>}</section>
      <section className={styles.section} aria-label="Worth watching"><div className={styles.sectionHead}><h2>Research candidates</h2>
        {view.candidates.length>3&&<button className={styles.textButton} aria-expanded={all} onClick={()=>setAll(!all)}>{all?'Show less':`View all (${view.candidates.length})`}</button>}</div>
        {candidates.length?<div className={styles.grid}>{candidates.map(candidate=><article className={styles.ideaCard} key={candidate.code}>
          <span className={styles.pill} data-tone="blue">Screening observation</span><h3>{candidate.name}</h3><p className={styles.code}>{candidate.code}</p>
          <p>Relative strength {signed(candidate.relativeStrengthPct)}</p><p className={styles.cardReason}>Both screening conditions met in this snapshot. Company quality, entry timing and risk need separate review.</p>
          <button className={styles.secondaryButton} disabled={!researchEnabled} onClick={()=>setCandidate(candidate)}>{researchEnabled?'Explore company ↗':'Waiting for complete data'}</button>
        </article>)}</div>:<p className={styles.sectionNote}>{freshness==='stale'?'Screening data is stale. Wait for a new snapshot.':screeningUnavailable?'Screening unavailable: a required data source is missing. Review data status.':'No scanner candidate met both research conditions in this snapshot.'}</p>}</section>
      <IntelligenceBoard snapshot={snapshot} alerts={data.alerts} marketPulse={data.marketPulse} currentOnly/>
      {data.alerts.length>0&&<details className={styles.movement}><summary>Movement history · {data.alerts.length} dated observations</summary><AlertBoard alerts={data.alerts} tradeDate={snapshot.tradeDate}/></details>}
      {data.marketPulse&&(data.marketPulse.status==='available'||data.marketPulse.status==='partial')&&
        <details className={styles.movement}><summary>Saved delayed quote observations</summary><MarketPulse pulse={data.marketPulse}/></details>}
      {v2&&<section className={styles.section} aria-label="Evidence review"><div className={styles.sectionHead}><h2>Company evidence</h2></div>
        {(review??v2.top10).entries.length===0&&<p className={styles.sectionNote}>Top 10 draft unavailable. No reviewed company draft is available.</p>}
        {(review??v2.top10).entries.length>0&&<><p>{review?.status==='draft'?'Research draft awaiting your review.':'Saved company research.'}</p>
          <ul className={styles.detailList}>{(review??v2.top10).entries.map(entry=><li key={entry.code}><div><strong>{entry.name} · {entry.code}</strong>
            <p>{entry.reasons.join(' ')}</p><small>{entry.evidence.source} · {entry.evidence.observedAt}</small>
            {entry.evidence.url?.startsWith('https://')&&<a href={entry.evidence.url} target="_blank" rel="noreferrer">Read source ↗</a>}</div></li>)}</ul>
          {review?.status==='draft'&&<div className={styles.toolbar}><button className={styles.primaryButton} disabled={actionBusy} onClick={()=>void decide('approved')}>Approve Top 10</button>
            <button className={styles.secondaryButton} disabled={actionBusy} onClick={()=>void decide('rejected')}>Reject Top 10</button></div>}</>}
        {actionStatus&&<p role="status">{actionStatus}</p>}
        <details className={styles.evidenceDisclosure}><summary>Review and save an official company source</summary><EvidenceReviewForm/></details>
      </section>}
    </>}
    {viewId==='assistant'&&<><div className={styles.viewHeading}><h1>Assistant</h1><p>Ask about your evidence and save a decision note for later review.</p></div><CopilotRail/></>}
    <footer className={styles.footer}><span>TASI · Evidence for your next review</span><p>Delayed analysis. Check live prices in your broker. Every trade remains yours to execute.</p></footer>
    {selected&&<DetailDialog title={selected.name} onClose={close}><StockDetails stock={selected}/></DetailDialog>}
    {!selected&&panel==='trade'&&portfolio&&!ledgerError&&<DetailDialog title="Record completed activity" onClose={close}>
      <PortfolioActivityForm portfolio={portfolio} onSaved={()=>void refresh()}/></DetailDialog>}
    {!selected&&panel==='status'&&<DetailDialog title="Data status" onClose={close}>
      <section><h3>Prices</h3><p>{priceDateLabel}. {staleCount?`${staleCount} quote(s) are stale.`:'Quote dates are shown beside each company.'}</p>
        <p>Snapshot saved {formatCockpitTimestamp(snapshot.asOf)}.</p></section>
      <details data-label="Delivery"><summary>Delivery details</summary><p>Producer {delivery?.producer.status??'unknown'} · Discord {delivery?.discord.status??'unknown'} · Cockpit {delivery?.cockpit.status??'unknown'}</p>
        {delivery?.discord.status==='confirmed'&&<small>Discord is confirmed by an authenticated receipt.</small>}</details>
      <section><h3>News and filings</h3>{sourceStatuses.map(line=><p key={line}>{line}</p>)}
        {sourceFailures>0&&<p>A failed check does not establish that nothing changed.</p>}<small>Open a company for evidence and publication dates.</small></section>
      {data.marketPulse&&<section><h3>Delayed observations</h3><p>Saved observation status: {data.marketPulse.status}. Daily quote coverage is assessed separately.</p></section>}
      <section data-label="AI perspective"><h3>AI perspective</h3><p>{v3?.leanStatus.ok?'Available as an optional interpretation.':`No AI interpretation for this snapshot.${v3?.leanStatus.httpStatus===504?' The provider timed out.':v3?.leanStatus.reason?` ${v3.leanStatus.reason}`:' Generation status is unavailable.'}`}</p>
        {v3?.leanStatus.reason&&<details><summary>Provider details</summary><p>{v3.leanStatus.reason}</p>
          <ul>{v3.leanStatus.attempts?.map((attempt,i)=><li key={i}>{attempt.provider}: {attempt.reason}{attempt.httpStatus?` (${attempt.httpStatus})`:''}</li>)}</ul></details>}</section>
      {visibleWarnings.length>0&&<section><h3>Source notes</h3><ul>{visibleWarnings.map(warning=><li key={warning}>{/scheduled pre-open digest did not run/i.test(warning)?`Snapshot ${snapshot.tradeDate}: ${warning}`:warning}</li>)}</ul></section>}
      {indexWarning&&<details><summary>Index diagnostics</summary><ul>{statusWarnings.filter(warning=>/TASI index unavailable|Market regime unavailable:.*index/i.test(warning)).map(warning=><li key={warning}>{warning}</li>)}</ul></details>}
      <button className={styles.secondaryButton} onClick={()=>void refresh(true)} disabled={busy}>Refresh data</button>
    </DetailDialog>}
  </main>;
}
