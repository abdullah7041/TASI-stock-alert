"use client";
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candidate, DashboardPayload } from '@/app/lib/dashboard-types';
import type { PortfolioBook, BrokerAccountId } from '@/app/lib/evidence-types';
import { buildPortfolioBook, parsePortfolioBook } from '@/app/lib/portfolio-core.mjs';
import { buildDecisionView } from '@/app/lib/decision-view.mjs';
import type { StockDecision } from '@/app/lib/decision-view.mjs';
import { PortfolioAccounts, brokerName } from './PortfolioAccounts';
import { AlertBoard, formatCockpitTimestamp } from './AlertBoard';
import { ResearchWorkspace } from './ResearchWorkspace';
import { DetailDialog, ExecutedTradeForm, StockDetails } from './CockpitDetails';
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
  const [book,setBook]=useState<PortfolioBook|null>(null), [ledgerError,setLedgerError]=useState(false);
  const [accountId,setAccountId]=useState<BrokerAccountId|null>(null);
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
          if(!r.ok)throw new Error('Ledger unavailable');return parsePortfolioBook(await r.json());
        }),
        fetch('/api/dashboard',{cache:'no-store',signal:controller.signal}).then(async r=>{
          const value=await r.json();if(!r.ok||!value.snapshot)throw new Error('Snapshot unavailable');return value as DashboardPayload;
        }),
      ]);
      if(ledgerResult.status==='fulfilled') {
        const next=ledgerResult.value;
        setBook(current=>current?buildPortfolioBook(next.accounts.flatMap((account,index)=>
          !account.error&&account.revision<current.accounts[index].revision
            ?current.accounts[index].records:account.records),next.legacy.events):next);
        setLedgerError(false);
      } else setLedgerError(true);
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
    {ledgerError&&<p className={styles.notice} role="status">Account refresh failed. Last confirmed account data may be stale.</p>}
    {book&&viewId!=='assistant'&&<PortfolioAccounts book={book} accountId={accountId} onAccountChange={setAccountId} onSaved={()=>void refresh()}/>}
    {viewId==='assistant'&&<CopilotRail/>}
  </main>;

  const {snapshot,freshness}=data, v2=snapshot.schemaVersion===1?null:snapshot, v3=snapshot.schemaVersion===3?snapshot:null;
  const selectedAccount=book?.accounts.find(account=>account.accountId===accountId);
  const combinedHoldings=book?[...new Set(book.accounts.flatMap(account=>account.holdings.map(h=>h.code)))].map(code=>{
    const positions=book.accounts.flatMap(account=>account.holdings.filter(h=>h.code===code));
    return {code,name:positions[0].name,shares:positions.reduce((n,h)=>n+h.shares,0)};
  }):[];
  const livePortfolio=selectedAccount??(book?{confirmedAt:snapshot.asOf,cashSar:book.combined.cashSar,
    contributionMonth:null,holdings:combinedHoldings,proposal:null,policyStatus:'unconfigured' as const}:null);
  const view=buildDecisionView(snapshot,freshness,livePortfolio), candidates=all?view.candidates:view.candidates.slice(0,3);
  const setupRequired=Boolean(book?.accounts.some(account=>!account.initialized));
  const policyPending=Boolean(book||v2?.portfolio.policyStatus==='unconfigured');
  const reviews=view.holdings.filter(stock=>stock.unavailable||stock.needsAttention);
  const quotes=[...view.holdings,...view.watchlist], staleCount=quotes.filter(stock=>stock.quoteState==='stale').length;
  const priceDateLabel=view.priceDates.length===0?'Quotes unavailable':view.priceDates.length===1
    ?`Quotes dated ${view.priceDates[0]}`:`Quotes dated ${view.priceDates[0]} to ${view.priceDates.at(-1)}`;
  const screeningUnavailable=Boolean(v2?.indexUnavailable)||snapshot.warnings.some(warning=>/scanner.*(failed|unavailable)/i.test(warning));
  const researchEnabled=freshness==='current'&&!screeningUnavailable&&import.meta.env.VITE_AGENT_ENABLED!=='false';
  const delivery=data.delivery, review=v3?.top10Review??(v2?.top10.status==='draft'?v2.top10:null);
  const quotePrices=quotes.filter(stock=>stock.quoteState==='current'&&stock.price!==null)
    .map(stock=>({code:stock.code,price:stock.price!,asOf:stock.priceDate!}));
  const sourceFailures=v3?.digestRecords.filter(record=>record.news?.ok===false).length??0;

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
      <div className={styles.toolbar}>{selectedAccount&&<span className={styles.cash}>{money(selectedAccount.cashSar)} cash</span>}
        {selectedAccount?.initialized&&!ledgerError&&!selectedAccount.error&&
          <button className={styles.textButton} onClick={()=>setPanel('trade')}>Record a trade ↗</button>}</div></div>
    {view.holdings.length?<div className={styles.grid}>{view.holdings.map(stock=>
      <StockCard key={stock.code} stock={stock} onOpen={()=>setSelected(stock)}/>)}</div>:
      <div className={styles.empty}><h3>{setupRequired?'Your portfolio starts with a confirmed account':'No confirmed holdings'}</h3>
        <p>{setupRequired?'Add the cash and holdings shown in each broker account.':'Your ledger currently has no owned stocks. Watchlist companies remain in Research.'}</p>
        <button className={styles.secondaryButton} onClick={()=>navigate('portfolio')}>Set up accounts</button></div>}
    {!book&&<p className={styles.sectionNote}>Saved holdings are unassigned legacy data. Confirm broker accounts before using account totals.</p>}
  </section>;

  return <main className={styles.page}>{header}{navigation}
    {error&&<p className={styles.notice} role="status">{error}</p>}
    {ledgerError&&<p className={styles.notice} role="status">Live portfolio ledger is unavailable. Last confirmed account data may be stale; refresh before recording activity.</p>}
    {refreshStatus&&<p className={styles.refreshStatus} role="status" aria-live="polite">{refreshStatus}</p>}
    {viewId==='overview'&&<>
      <section className={styles.today} aria-label="Daily freshness">
        <div className={styles.briefing}><h1>Portfolio overview</h1>
          <p className={styles.takeaway}>{setupRequired?'Complete account setup':view.incomplete?'Some checks unavailable':
            policyPending?'Company reviews are pending':reviews.length?'Review the dated observations below':'Your daily check-in is ready'}</p>
          <p className={styles.muted}>{setupRequired?'Confirm each broker account to see your holdings and cash.':
            policyPending?'Use the dated evidence to review your companies. No trade quantity is proposed.':'Review what changed, then check current prices in your broker.'}</p>
          <p className={styles.date}>Daily snapshot for {snapshot.tradeDate}</p>
          <p className={styles.date}>{priceDateLabel} · Saved {formatCockpitTimestamp(snapshot.asOf)}</p>
        </div>
        <div className={styles.briefAction}><button className={styles.primaryButton} onClick={()=>navigate(setupRequired?'portfolio':'research')}>
          {setupRequired?'Set up accounts':'Review company evidence'}</button></div>
      </section>
      <div className={styles.metricGrid}>
        <article className={styles.metricCard}><span>{book?'Confirmed holdings':'Unassigned holdings'}</span><strong>{setupRequired?'Setup required':view.holdings.length}</strong><small>{selectedAccount?brokerName(selectedAccount.accountId):book?'Across your broker accounts':'Broker records unavailable'}</small></article>
        <article className={styles.metricCard}><span>Account cash</span><strong>{money(selectedAccount?.cashSar??book?.combined.cashSar??null)}</strong><small>Combined totals are reporting only</small></article>
        <article className={styles.metricCard}><span>Quote coverage</span><strong>{staleCount?'Stale quotes':quotes.some(stock=>stock.quoteState==='unavailable')?'Partial data':quotes.length?'Dated daily quotes':'Unavailable'}</strong><small>{snapshot.expectedPriceDate?`Expected session ${snapshot.expectedPriceDate}`:'Check the date beside each company'}</small></article>
      </div>
      {freshness==='stale'&&<p className={styles.notice} aria-label="Stale data warning">The expected pre-open refresh did not arrive. This is the last successful daily snapshot; research is disabled.</p>}
      {freshness!=='stale'&&(staleCount>0||sourceFailures>0||snapshot.warnings.length>0)&&
        <p className={styles.notice} aria-label="Data quality warning">{staleCount?`${staleCount} quote(s) are older than the expected session. `:''}
          {sourceFailures?`News retrieval failed for ${sourceFailures} stock(s). `:''}
          <button className={styles.textButton} onClick={()=>setPanel('status')}>Review data status</button></p>}
      {book&&<PortfolioAccounts book={book} accountId={accountId} onAccountChange={setAccountId}
        onSaved={()=>void refresh()} prices={quotePrices} compact/>}
      <section className={styles.section} aria-label="Review items"><div className={styles.sectionHead}><h2>Needs review</h2>
        <button className={styles.textButton} onClick={()=>navigate('research')}>Open Research ↗</button></div>
        {setupRequired?<p className={styles.sectionNote}>Account setup is incomplete. Confirm opening snapshots in Portfolio.</p>:
          reviews.length?<div className={styles.reviewList}>{reviews.map(stock=><button key={stock.code} onClick={()=>setSelected(stock)}>
            <strong>{stock.name}</strong><span>{stock.reason}</span><span>View evidence ↗</span></button>)}</div>:
          <p className={styles.sectionNote}>{policyPending?'Company assessments are pending. Review sources before reaching an investment conclusion.':
            view.incomplete?'Review coverage is incomplete; check source availability.':'No new review item in this dated snapshot.'}</p>}
      </section>
      {holdings}
    </>}
    {viewId==='portfolio'&&<><div className={styles.viewHeading}><h1>Portfolio</h1><p>Confirm your accounts and keep a clear record of completed activity.</p></div>
      {book?<PortfolioAccounts book={book} accountId={accountId} onAccountChange={setAccountId} onSaved={()=>void refresh()} prices={quotePrices}/>:
        <p className={styles.notice}>Account records are unavailable. Refresh before recording activity.</p>}
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
        {(review??v2.top10).entries.length===0&&<p className={styles.sectionNote}>No reviewed company draft is available.</p>}
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
    {!selected&&panel==='trade'&&selectedAccount&&!ledgerError&&<DetailDialog title="Record an executed trade" onClose={close}>
      <ExecutedTradeForm portfolio={selectedAccount} onSaved={()=>void refresh()}/></DetailDialog>}
    {!selected&&panel==='status'&&<DetailDialog title="Data status" onClose={close}>
      <section><h3>Prices</h3><p>{priceDateLabel}. {staleCount?`${staleCount} quote(s) are stale.`:'Quote dates are shown beside each company.'}</p>
        <p>Snapshot saved {formatCockpitTimestamp(snapshot.asOf)}.</p></section>
      <section data-label="Delivery"><h3>Delivery</h3><p>Producer {delivery?.producer.status??'unknown'} · Discord {delivery?.discord.status??'unknown'} · Cockpit {delivery?.cockpit.status??'unknown'}</p>
        <small>Discord is confirmed by an authenticated receipt.</small></section>
      <section><h3>News and filings</h3><p>{sourceFailures? `News unavailable for ${sourceFailures} stock(s). This does not mean there was no news.`:
        'Open a company to see whether sources were collected, returned no content, or supplied dated evidence.'}</p></section>
      {data.marketPulse&&<section><h3>Delayed observations</h3><p>Saved observation status: {data.marketPulse.status}. Daily quote coverage is assessed separately.</p></section>}
      <section data-label="AI perspective"><h3>AI perspective</h3><p>{v3?.leanStatus.ok?'Available as an optional interpretation.':'Unavailable. Dated market facts remain visible.'}</p>
        {v3?.leanStatus.reason&&<details><summary>Provider details</summary><p>{v3.leanStatus.reason}</p></details>}</section>
      {snapshot.warnings.length>0&&<section><h3>Source notes</h3><ul>{snapshot.warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></section>}
      <button className={styles.secondaryButton} onClick={()=>void refresh(true)} disabled={busy}>Refresh data</button>
    </DetailDialog>}
  </main>;
}
