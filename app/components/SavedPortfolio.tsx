"use client";
import {useRef,useState} from 'react';
import type {AccountRecordInput,SavedPortfolio} from '@/app/lib/evidence-types';
import {parseSavedPortfolio} from '@/app/lib/portfolio-core.mjs';
import {formatCockpitTimestamp} from './AlertBoard';
import styles from './FriendlyCockpit.module.css';

export function PortfolioActivityForm({portfolio,onSaved}:{portfolio:SavedPortfolio;onSaved:()=>void}) {
  const [kind,setKind]=useState('buy'),[time,setTime]=useState(''),[code,setCode]=useState(''),[name,setName]=useState('');
  const [shares,setShares]=useState(''),[price,setPrice]=useState(''),[fees,setFees]=useState(''),[amount,setAmount]=useState('');
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const operation=useRef<string|null>(null);
  const [preview,setPreview]=useState<{envelope:{schemaVersion:3;record:AccountRecordInput;expectedRevision:number};result:SavedPortfolio}|null>(null);
  const trade=kind==='buy'||kind==='sell';
  const alreadySaved=Boolean(preview&&portfolio.events.some(event=>event.operationId===preview?.envelope.record.operationId));
  const stale=Boolean(preview&&preview.envelope.expectedRevision!==portfolio.eventCount&&!alreadySaved);
  function invalidate(){operation.current=null;setPreview(null);setMessage('');}
  async function submit(confirm:boolean){
    if(busy)return;setBusy(true);setMessage('');
    try{
      const envelope=confirm?preview?.envelope:{schemaVersion:3 as const,expectedRevision:portfolio.eventCount,record:{
        operationId:operation.current??(operation.current=crypto.randomUUID()),kind:'event' as const,payload:{
          kind:kind as 'buy',occurredAt:new Date(`${time}+03:00`).toISOString(),provenance:{source:'manual' as const},
          ...(trade?{code,name:portfolio.view.holdings.find(h=>h.code===code)?.name??name,shares:Number(shares),priceSar:Number(price),feesSar:Number(fees)}:{cashSar:Number(amount)})}}};
      if(!envelope||(confirm&&stale))throw new Error('Portfolio changed. Preview again before confirming.');
      const response=await fetch(confirm?'/api/portfolio/events':'/api/portfolio/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)});
      const body=await response.json();if(!response.ok)throw new Error(body.error??'Could not save activity. Retry the same record.');
      const result=parseSavedPortfolio(body);
      if(confirm){setPreview(null);operation.current=null;setMessage('Completed activity saved. No order was sent.');onSaved();}
      else setPreview({envelope,result});
    }catch(error){setMessage(error instanceof Error?error.message:'Activity unavailable. Retry the same record.');}
    finally{setBusy(false);}
  }
  return <form onSubmit={event=>{event.preventDefault();void submit(false);}} onChange={invalidate}>
    <fieldset disabled={busy||!portfolio.eventCount}><legend>Record completed activity</legend>
      <p>Record what you already completed. No order is sent.</p>
      <label>Activity<select value={kind} onChange={e=>setKind(e.target.value)}>{['buy','sell','contribution','withdrawal','dividend','fee'].map(value=><option key={value} value={value}>{value}</option>)}</select></label>
      <label>Activity time (Riyadh)<input type="datetime-local" required value={time} onChange={e=>setTime(e.target.value)}/></label>
      {trade?<><label>Stock code<input required pattern="[0-9]{4}" value={code} onChange={e=>setCode(e.target.value)}/></label>
        <label>Company name<input required value={portfolio.view.holdings.find(h=>h.code===code)?.name??name} onChange={e=>setName(e.target.value)}/></label>
        <label>Shares<input type="number" required min="1" step="1" value={shares} onChange={e=>setShares(e.target.value)}/></label>
        <label>Executed price (SAR)<input type="number" required min="0.01" step="any" value={price} onChange={e=>setPrice(e.target.value)}/></label>
        <label>Actual fees (SAR)<input type="number" required min="0" step="0.01" value={fees} onChange={e=>setFees(e.target.value)}/></label></>:
        <label>Amount (SAR)<input type="number" required min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>}
      <button className={styles.secondaryButton}>Preview record</button>
      {preview&&<div role="status"><p>Recorded cash after activity: {preview.result.view.cashSar?.toFixed(2)} SAR. Holdings: {preview.result.view.holdings.map(h=>`${h.code}: ${h.shares}`).join(', ')||'none'}.</p>
        {stale&&<p>Portfolio changed. Preview again.</p>}{alreadySaved&&<p>This activity is already recorded. Retry confirmation to finish.</p>}<button type="button" className={styles.primaryButton} disabled={stale} onClick={()=>void submit(true)}>Confirm record</button></div>}
    </fieldset>{message&&<p role="status">{message}</p>}
  </form>;
}

export function SavedPortfolioPanel({portfolio,onSaved,readOnly=false}:{portfolio:SavedPortfolio;onSaved:()=>void;readOnly?:boolean}){
  return <section className={styles.section} aria-label="Saved portfolio"><h2>Saved portfolio</h2>
    <p>{portfolio.view.cashSar===null?'Recorded cash unavailable':`${portfolio.view.cashSar.toFixed(2)} SAR recorded cash`}</p>
    <p>Last recorded: {portfolio.view.confirmedAt?formatCockpitTimestamp(portfolio.view.confirmedAt):'No saved history'}. Check your broker for current balances.</p>
    <details><summary>Saved transaction history · {portfolio.eventCount} records</summary><ul>{portfolio.events.map(event=><li key={event.operationId}>
      {event.kind.replaceAll('_',' ')} · {event.name??event.code??''}{event.shares!==undefined?` · ${event.shares} shares`:''}{event.priceSar!==undefined?` at ${event.priceSar.toFixed(2)} SAR`:''}{event.cashSar!==undefined?` · ${event.cashSar.toFixed(2)} SAR`:''} · {formatCockpitTimestamp(event.confirmedAt)}
    </li>)}</ul></details>
    {!readOnly&&portfolio.eventCount>0&&<PortfolioActivityForm portfolio={portfolio} onSaved={onSaved}/>}
  </section>;
}
