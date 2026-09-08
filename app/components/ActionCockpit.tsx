"use client";
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Candidate, DashboardPayload } from '@/app/lib/dashboard-types';
import { buildDecisionView } from '@/app/lib/decision-view.mjs';
import type { StockDecision } from '@/app/lib/decision-view.mjs';
import { AlertBoard, formatCockpitTimestamp } from './AlertBoard';
import { ResearchWorkspace } from './ResearchWorkspace';
import { DetailDialog, ExecutedTradeForm, StockDetails } from './CockpitDetails';
import styles from './FriendlyCockpit.module.css';

const signed=(n:number|null)=>n===null?'—':`${n>0?'+':''}${n.toFixed(1)}%`;
const price=(n:number|null)=>n===null?'—':n.toLocaleString('en-SA',{minimumFractionDigits:2,maximumFractionDigits:2});

function Sparkline({stock}:{stock:StockDecision}) {
  const bars=stock.chart?.status==='available'?stock.chart.bars.slice(-30):[];
  if(bars.length<2)return <div className={styles.noChart}>Price history unavailable</div>;
  const values=bars.map(b=>b.Close),min=Math.min(...values),span=Math.max(...values)-min||1;
  const points=values.map((v,i)=>`${i*240/(values.length-1)},${48-(v-min)/span*38}`).join(' ');
  return <svg className={styles.sparkline} viewBox="0 0 240 56" aria-label={`${stock.name} recent daily prices`} role="img"><title>{stock.name}: last {bars.length} daily closes</title><path d={`M0,56 L${points.replaceAll(' ',' L')} L240,56 Z`} fill="currentColor" opacity=".08"/><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>{bars.map((bar,i)=><circle key={bar.date} cx={i*240/(values.length-1)} cy={48-(bar.Close-min)/span*38} r="5" fill="transparent"><title>{bar.date}: {bar.Close.toFixed(2)} SAR</title></circle>)}</svg>;
}

function StockCard({stock,onOpen}:{stock:StockDecision;onOpen:()=>void}) {
  return <button className={styles.stockCard} onClick={onOpen} aria-label={`View ${stock.name} details`} data-tone={stock.needsAttention?'warning':stock.unavailable?'muted':'normal'}>
    <span className={styles.cardHeader}><span className={styles.monogram} aria-hidden="true">{stock.name.split(' ').map(s=>s[0]).slice(0,2).join('')}</span><span><strong className={styles.stockName}>{stock.name}</strong><span className={styles.code}>{stock.code}{stock.shares!==null?` · ${stock.shares} shares`:''}</span></span><span className={styles.cardArrow} aria-hidden="true">↗</span></span>
    <span className={styles.priceRow}><strong>{price(stock.price)} <small>SAR</small></strong><span data-direction={(stock.dailyChange??0)<0?'down':'up'}>{signed(stock.dailyChange)}<small>last session</small></span></span>
    <Sparkline stock={stock}/>
    <span className={styles.cardMeta}><span className={styles.pill} data-tone={stock.needsAttention?'warning':stock.unavailable?'muted':stock.owned?'green':'blue'}>{stock.label}</span>{stock.owned&&<span className={styles.pnl}>P/L <strong>{signed(stock.pnl)}</strong></span>}</span>
    <span className={styles.cardReason}>{stock.reason}</span>
    {!stock.owned&&stock.conditionsTotal!==null&&<span className={styles.conditions}><progress value={stock.conditionsMet??0} max={stock.conditionsTotal||1}/>{stock.conditionsMet??0} of {stock.conditionsTotal} conditions met</span>}
    <span className={styles.priceDate}>Price date {stock.priceDate??'unavailable'}{stock.unavailable?' · Check current data':''}</span>
  </button>;
}

export function ActionCockpit({dashboard}:{dashboard:DashboardPayload|null}) {
  const [data,setData]=useState(dashboard),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const [refreshStatus,setRefreshStatus]=useState('');
  const dataRef=useRef(dashboard);
  const [selected,setSelected]=useState<StockDecision|null>(null),[panel,setPanel]=useState<'status'|'trade'|'watchlist'|null>(null);
  const [candidate,setCandidate]=useState<Candidate|null>(null),[all,setAll]=useState(false);
  const [actionStatus,setActionStatus]=useState(''),[actionBusy,setActionBusy]=useState(false);
  const refresh=useCallback(async(announce=false)=>{
    setBusy(true);if(announce)setRefreshStatus('Checking for the latest saved snapshot…');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15_000);
    try{
      const r=await fetch('/api/dashboard',{cache:'no-store',signal:controller.signal});const next=await r.json();
      if(!r.ok||!next.snapshot)throw new Error(next.error??'Snapshot unavailable');
      const previous=dataRef.current?.snapshot;
      const priorKey=previous?.schemaVersion===3?previous.artifactId:previous?`${previous.schemaVersion}:${previous.tradeDate}:${previous.asOf}`:null;
      const nextKey=next.snapshot.schemaVersion===3?next.snapshot.artifactId:`${next.snapshot.schemaVersion}:${next.snapshot.tradeDate}:${next.snapshot.asOf}`;
      dataRef.current=next;setData(next);setError(null);
      if(announce)setRefreshStatus(next.freshness==='stale'
        ?`Latest saved snapshot is still stale (${next.snapshot.tradeDate}).`
        :priorKey===nextKey?'Already showing the latest saved daily snapshot.':`Updated to daily snapshot for ${next.snapshot.tradeDate}.`);
    }
    catch{setError('Refresh failed. Showing the last good view. Try again shortly.');if(announce)setRefreshStatus('Refresh failed; the last good snapshot remains visible.');}
    finally{clearTimeout(timeout);setBusy(false);}
  },[]);
  useEffect(()=>{const initial=setTimeout(()=>void refresh(),0);const visible=()=>{if(document.visibilityState==='visible')void refresh();};const interval=setInterval(visible,60_000);document.addEventListener('visibilitychange',visible);return()=>{clearTimeout(initial);clearInterval(interval);document.removeEventListener('visibilitychange',visible);};},[refresh]);
  if(candidate)return <ResearchWorkspace candidate={candidate} onClose={()=>setCandidate(null)}/>;
  if(!data)return <main className={styles.page}><p className={styles.brand}>TASI Action Cockpit</p><h1>{error?'No verified daily snapshot is available.':'Loading the latest saved daily digest…'}</h1>{error&&<button onClick={()=>void refresh(true)}>Try again</button>}</main>;
  const {snapshot,freshness}=data,v2=snapshot.schemaVersion===1?null:snapshot,v3=snapshot.schemaVersion===3?snapshot:null;
  const view=buildDecisionView(snapshot,freshness),candidates=all?view.candidates:view.candidates.slice(0,3);
  const priceDateLabel=view.priceDates.length===0?'Prices unavailable'
    :view.priceDates.length===1?`Prices from previous close ${view.priceDates[0]}`
    :`Latest available prices dated ${view.priceDates[0]} to ${view.priceDates.at(-1)}`;
  const researchEnabled=freshness==='current'&&import.meta.env.VITE_AGENT_ENABLED!=='false';
  const delivery=data.delivery,review=v3?.top10Review??(v2?.top10.status==='draft'?v2.top10:null);
  const close=()=>{setSelected(null);setPanel(null);};
  const warning=snapshot.warnings.find(w=>/late|price|market|stale/i.test(w));
  async function decide(decision:'approved'|'rejected'){
    if(!review?.entries.length||actionBusy)return;setActionBusy(true);setActionStatus('');
    try{const response=await fetch('/api/top10/approve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({proposalId:review.proposalId,decision,decidedAt:new Date().toISOString()})});const body=await response.json();if(!response.ok)throw new Error(body.error??'Could not save decision');setActionStatus(`Top 10 ${decision}.`);await refresh();}
    catch(e){setActionStatus(e instanceof Error?e.message:'Could not save decision');}finally{setActionBusy(false);}
  }
  return <main className={styles.page}>
    <header className={styles.header}><Link className={styles.brand} href="/" aria-label="TASI home"><span className={styles.logo} aria-hidden="true">↗</span>TASI <span>daily cockpit</span></Link><div className={styles.toolbar}><span className={styles.liveDot}>Delayed/daily data</span><button className={styles.secondaryButton} onClick={()=>setPanel('status')}>Data status <span aria-hidden="true">◉</span></button><button className={styles.iconButton} aria-label="Refresh cockpit" disabled={busy} onClick={()=>void refresh(true)}>{busy?'…':'↻'}</button></div></header>
    {error&&<p className={styles.notice} role="status">{error}</p>}
    {refreshStatus&&<p className={styles.refreshStatus} role="status" aria-live="polite">{refreshStatus}</p>}
    <section className={styles.today} aria-labelledby="today-heading"><div className={styles.briefing}><p className={styles.eyebrow}>YOUR DAILY CHECK-IN</p><h1 id="today-heading">A little clarity.<br/><span>A better next step.</span></h1><p className={styles.takeaway}>{view.attention?`${view.attention} holding${view.attention===1?' needs':'s need'} your review.`:view.incomplete?'Some checks unavailable':'No holding needs a rule-based action.'}</p><p className={styles.muted}>{view.attention?'Review the highlighted holdings below.':view.incomplete?'Your saved holdings are here. Check the data notes before making a decision.':'Your holdings are below, with the next levels to watch.'}</p><p className={styles.date}>Daily snapshot for {snapshot.tradeDate}</p><p className={styles.date}>{priceDateLabel} <span>· Saved {formatCockpitTimestamp(snapshot.asOf)}</span></p></div><div className={styles.attention}><span className={styles.orbit} aria-hidden="true">{view.attention?'!':'↗'}</span><strong>{view.attention}</strong><span>{view.attention===1?'holding needs':'holdings need'} action</span><small>{view.holdings.length} holdings tracked</small></div></section>
    {freshness==='stale'?<p className={styles.notice} aria-label="Stale data warning">The expected pre-open refresh did not arrive. This is the last successful daily snapshot; research is disabled.</p>:warning&&<p className={styles.notice} aria-label="Data quality warning">{warning}</p>}
    <section className={styles.section} aria-label="My holdings"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>YOUR PORTFOLIO</p><h2>My holdings <span>{view.holdings.length}</span></h2></div><div className={styles.toolbar}>{v2&&<span className={styles.cash}>{price(v2.portfolio.cashSar)} SAR cash</span>}{v2&&<button className={styles.textButton} onClick={()=>setPanel('trade')}>Record a trade ↗</button>}</div></div>{view.holdings.length?<div className={styles.grid}>{view.holdings.map(stock=><StockCard key={stock.code} stock={stock} onOpen={()=>setSelected(stock)}/>)}</div>:<div className={styles.empty}><span aria-hidden="true">◎</span><h3>Your portfolio starts here</h3><p>No confirmed holdings are available. Record an executed trade to start your ledger.</p></div>}</section>
    <section className={styles.section} aria-label="Worth watching"><div className={styles.sectionHead}><div><p className={styles.eyebrow}>ROOM FOR RESEARCH</p><h2>Worth watching</h2></div><div className={styles.toolbar}>{view.watchlist.length>0&&<button className={styles.textButton} onClick={()=>setPanel('watchlist')}>Your watchlist ({view.watchlist.length})</button>}{view.candidates.length>3&&<button className={styles.textButton} aria-expanded={all} onClick={()=>setAll(!all)}>{all?'Show less':`View all (${view.candidates.length})`}</button>}</div></div><p className={styles.sectionNote}>Screening ideas, not buy instructions. Get to know a company before deciding.</p>{candidates.length?<div className={styles.grid}>{candidates.map((c,i)=><article className={styles.ideaCard} key={c.code}><span className={styles.ideaNumber}>0{i+1}</span><span className={styles.pill} data-tone="blue">Research candidate</span><h3>{c.name}</h3><p className={styles.code}>{c.code}</p><p>Relative strength <strong>+{c.relativeStrengthPct.toFixed(1)}%</strong></p><p className={styles.cardReason}>{c.squeeze?'Relative strength and quiet trading met the scanner conditions.':'Two research conditions met.'} Entry, valuation and risk still need review.</p><div className={styles.conditions}><progress value={2} max={2}/>2 of 2 screening conditions</div><button className={styles.secondaryButton} disabled={!researchEnabled} onClick={()=>setCandidate(c)}>{researchEnabled?'Explore company ↗':'Waiting for fresh data'}</button></article>)}</div>:<div className={styles.empty}><span aria-hidden="true">⌕</span><h3>Nothing new on the shortlist</h3><p>No scanner candidates met both research conditions in this daily snapshot.</p></div>}</section>
    {data.alerts.length>0&&<details className={styles.movement}><summary>Delayed movement history <span>{data.alerts.length} observations</span></summary><AlertBoard alerts={data.alerts} tradeDate={snapshot.tradeDate}/></details>}
    <footer className={styles.footer}><span>Made for a clearer daily check-in.</span><p>Broker app handles real-time price alerts. This cockpit provides delayed analysis and never sends an order.</p></footer>
    {selected&&<DetailDialog title={selected.name} onClose={close}><StockDetails stock={selected}/></DetailDialog>}
    {!selected&&panel==='watchlist'&&<DetailDialog title="Your watchlist" onClose={close}><p className={styles.muted}>Entry conditions for the companies you follow. These are not owned holdings.</p><div className={styles.dialogGrid}>{view.watchlist.map(stock=><StockCard key={stock.code} stock={stock} onOpen={()=>setSelected(stock)}/>)}</div></DetailDialog>}
    {!selected&&panel==='trade'&&v2&&<DetailDialog title="Record an executed trade" onClose={close}><ExecutedTradeForm portfolio={v2.portfolio} onSaved={()=>void refresh()}/></DetailDialog>}
    {!selected&&panel==='status'&&<DetailDialog title="Data status" onClose={close}>
      <p className={styles.muted}>What is available, what is missing, and why.</p><section><h3>Today’s summary</h3><ul>{v2?.summary.map(line=><li key={line}>{line}</li>)}</ul></section>
      <section data-label="Delivery"><h3>Delivery</h3><p>Producer {delivery?.producer.status??'unknown'} · Discord {delivery?.discord.status??'unknown'} · Cockpit {delivery?.cockpit.status??'unknown'}</p><small>Discord is confirmed only by an authenticated receipt.</small></section>
      <section data-label="AI perspective"><h3>AI perspective</h3><p>{v3?.leanStatus.ok?`Available · ${v3.leanStatus.provider} · ${v3.leanStatus.model??''}`:'Unavailable — the dashboard still shows deterministic facts.'}</p>{v3?.leanStatus.reason&&<details><summary>Technical details</summary><p>{v3.leanStatus.reason}</p></details>}</section>
      <section><h3>News and disclosures</h3><p>{v3?.digestRecords.filter(r=>r.news?.ok===false).length??0} stocks with news retrieval failures. Individual stocks show their available sources.</p></section>
      {v2&&<section data-label="Top 10"><h3>Top 10 research</h3><p>Evidence reviewed {formatCockpitTimestamp((review??v2.top10).researchedAt)}</p>{(review??v2.top10).entries.length?<><p>{review?'Research draft awaiting your review.':'Your approved research list.'}</p><ul className={styles.detailList}>{(review??v2.top10).entries.map(entry=><li key={entry.code}><div><strong>{entry.name}</strong><p>{entry.reasons.join(' ')}</p><small>{entry.evidence.source} · {entry.evidence.observedAt}</small>{entry.evidence.url?.startsWith('https://')&&<a href={entry.evidence.url} target="_blank" rel="noreferrer">Read source ↗</a>}</div></li>)}</ul>{review?.status==='draft'&&<div className={styles.toolbar}><button className={styles.primaryButton} disabled={actionBusy} onClick={()=>void decide('approved')}>Approve Top 10</button><button className={styles.secondaryButton} disabled={actionBusy} onClick={()=>void decide('rejected')}>Reject Top 10</button></div>}</>:<p>No researched Top 10 draft is available, so there is nothing to approve or reject. Issuer evidence must be collected and reviewed first.</p>}<p role="status">{actionStatus}</p></section>}
      {v2&&<section data-label="Forecast"><h3>Forecast</h3>{v2.forecast.status==='unavailable'?<><p>Forecast unavailable: validation gates have not passed.</p><details><summary>Validation details</summary><p>{v2.forecast.reason}</p></details></>:<p>{v2.forecast.targetFirstPct.toFixed(1)}% target-first probability over {v2.forecast.horizonSessions} sessions. Target {price(v2.forecast.target)} · stop {price(v2.forecast.stop)}.</p>}</section>}
      {snapshot.warnings.length>0&&<section><h3>Data notes</h3><ul>{snapshot.warnings.map(w=><li key={w}>{w}</li>)}</ul></section>}
    </DetailDialog>}
  </main>;
}
