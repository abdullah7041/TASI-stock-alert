"use client";
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { StockDecision } from '@/app/lib/decision-view.mjs';
import type { PortfolioView } from '@/app/lib/evidence-types';
import { PriceVolumeChart } from './PriceVolumeChart';
import styles from './FriendlyCockpit.module.css';

export function DetailDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const dialog=ref.current;
    if(dialog?.showModal) dialog.showModal(); else dialog?.setAttribute('open','');
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    return ()=>{dialog?.close?.();previous?.focus();};
  },[]);
  return <dialog ref={ref} className={styles.dialog} aria-label={title} onCancel={(e)=>{e.preventDefault();onClose();}} onKeyDown={(e)=>{
    if(e.key==='Escape'){e.preventDefault();onClose();}
    if(e.key==='Tab'){
      const nodes=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,textarea,[tabindex="0"]')??[]);
      const first=nodes[0],last=nodes.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  }}>
    <div className={styles.dialogHead}><h2>{title}</h2><button className={styles.iconButton} aria-label="Close details" onClick={onClose}>×</button></div>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}

function safeLink(url?:string){try{return url&&new URL(url).protocol==='https:'?url:undefined;}catch{return undefined;}}
export function StockDetails({stock}:{stock:StockDecision}) {
  const record=stock.record;
  const lean=record.lean;
  return <>
    <p className={styles.eyebrow}>{stock.code} · {stock.owned?'Your holding':'Watchlist'}</p>
    <p className={styles.detailPrice}>{stock.price?.toFixed(2)??'—'} <small>SAR</small></p>
    <span className={styles.pill} data-tone={stock.needsAttention?'warning':'blue'}>{stock.label}</span>
    <p>{stock.reason}</p>
    <p className={styles.muted}>Price date: {stock.priceDate??'unavailable'} · Delayed daily data. Verify live prices in your broker.</p>
    {stock.chart?<PriceVolumeChart chart={stock.chart} initiallyExpanded/>:<p>Chart unavailable for this stock.</p>}
    <section><h3>What changed</h3><p>{record.delta?.price_pct!==undefined?`${record.delta.price_pct>0?'+':''}${record.delta.price_pct.toFixed(1)}% last session.`:'Daily change unavailable.'} {record.delta?.trend_flipped?'The trend changed direction.':''} {record.delta?.rsi_delta!==undefined?`RSI changed by ${record.delta.rsi_delta.toFixed(1)}.`:''}</p></section>
    {stock.owned&&<section><h3>Decision checks</h3>{record.rules?.length?<ul className={styles.detailList}>{record.rules.map((rule)=><li key={rule.rule}><span>{rule.available===false?'?':rule.passed?'!':'✓'}</span>{rule.plain??rule.rule}</li>)}</ul>:<p>Deterministic decision checks are unavailable.</p>}</section>}
    {!stock.owned&&<section><h3>Entry conditions</h3>{record.rules?.length?<ul className={styles.detailList}>{record.rules.map((rule)=><li key={rule.rule}><span>{rule.passed?'✓':'○'}</span>{rule.plain??rule.rule}</li>)}</ul>:<p>No complete entry checklist is available.</p>}{record.triggers?.filter(t=>t.reachable&&t.trigger_price).map((t)=><p key={t.rule as string}>{t.plain??`Next condition near ${t.trigger_price?.toFixed(2)} SAR. This alone does not qualify a buy.`}</p>)}</section>}
    <section><h3>News & sources</h3><p className={styles.muted}>{record.news?.ok===false?'News retrieval failed. This does not mean there was no news.':record.news?.status==='partial'?'Some news sources are unavailable.':!record.news?'News was not collected.':record.news.headlines?.length?'Recent headlines':'No recent headlines found.'}</p><ul className={styles.detailList}>{record.news?.headlines?.map((n,i)=><li key={`${n.title}-${i}`}><div>{safeLink(n.link)?<a href={safeLink(n.link)} target="_blank" rel="noreferrer">{n.title} ↗</a>:n.title}{n.published&&<small>{n.published}</small>}</div></li>)}</ul>
      <h4>Company disclosures</h4>{record.disclosures?.items?.length?<ul>{record.disclosures.items.map((n,i)=><li key={i}>{safeLink(n.url??n.link)?<a href={safeLink(n.url??n.link)} target="_blank" rel="noreferrer">{n.title??'Disclosure'} ↗</a>:n.title}</li>)}</ul>:<p className={styles.muted}>{record.disclosures?.ok===false?'Disclosure retrieval failed.':record.disclosures?'No recent disclosures found.':'Disclosures were not collected.'}</p>}
    </section>
    <section><h3>AI perspective <span className={styles.muted}>· optional</span></h3>{!lean||lean.unavailable?<p className={styles.muted}>AI interpretation unavailable{lean?.unavailable?`: ${String(lean.unavailable)}`:'.'} The rule checks above do not depend on it.</p>:<><p>{String(lean.lean??lean.direction??'Model judgement')} · {String(lean.confidence??'confidence not provided')}</p><p>{String(lean.take??lean.reason??lean.rationale??lean.summary??'No explanation supplied.')}</p><small>Model judgement, not a validated forecast or a buy condition.</small></>}</section>
  </>;
}

export function ExecutedTradeForm({portfolio,onSaved}:{portfolio:PortfolioView;onSaved:()=>void}) {
  const [kind,setKind]=useState('buy'),[code,setCode]=useState(portfolio.proposal?.code??''),[name,setName]=useState('');
  const [shares,setShares]=useState(''),[price,setPrice]=useState(''),[fees,setFees]=useState('0');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const operation=useRef<string|null>(null);
  return <form className={styles.tradeForm} onSubmit={async(e)=>{
    e.preventDefault();if(busy)return;
    const quantity=Number(shares),priceSar=Number(price),feesSar=Number(fees);
    if(!Number.isInteger(quantity)||quantity<=0||!Number.isFinite(priceSar)||priceSar<=0||!Number.isFinite(feesSar)||feesSar<0){setMessage('Enter the actual positive share quantity and execution price.');return;}
    setBusy(true);setMessage('');operation.current??=crypto.randomUUID();
    try{
      const response=await fetch('/api/portfolio/events',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operationId:operation.current,kind,code,name:portfolio.holdings.find(h=>h.code===code)?.name??name,shares:quantity,priceSar,feesSar,confirmedAt:new Date().toISOString(),reason:'Executed trade entered by owner from broker receipt.'})});
      const body=await response.json();if(!response.ok)throw new Error(body.error??'The trade could not be recorded.');
      setMessage('Executed trade recorded. No order was sent.');operation.current=null;setShares('');setPrice('');onSaved();
    }catch(error){setMessage(error instanceof Error?error.message:'Could not record trade.');}finally{setBusy(false);}
  }}>
    <p>Enter a trade you have already executed in your broker. This only updates your ledger.</p>
    <fieldset disabled={busy} onChange={()=>{operation.current=null;}}>
      <label>Action<select value={kind} onChange={e=>setKind(e.target.value)}><option value="buy">Bought</option><option value="sell">Sold</option></select></label>
      <label>Stock code<input value={code} onChange={e=>setCode(e.target.value)} required pattern="[0-9]{4}" placeholder="e.g. 1303"/></label>
      {!portfolio.holdings.some(h=>h.code===code)&&<label>Company name<input value={name} onChange={e=>setName(e.target.value)} required/></label>}
      <label>Executed shares<input aria-label="Executed shares" type="number" min="1" step="1" value={shares} onChange={e=>setShares(e.target.value)} required/></label>
      <label>Execution price (SAR)<input aria-label="Execution price (SAR)" type="number" min="0.0001" step="any" value={price} onChange={e=>setPrice(e.target.value)} required/></label>
      <label>Fees (SAR)<input type="number" min="0" step="any" value={fees} onChange={e=>setFees(e.target.value)} required/></label>
      <button className={styles.primaryButton} type="submit">{busy?'Saving…':'Record executed trade'}</button>
    </fieldset><p role="status">{message}</p>
  </form>;
}
