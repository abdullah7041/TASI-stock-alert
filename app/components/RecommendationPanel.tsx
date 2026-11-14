'use client';
import { useEffect,useRef,useState } from 'react';
import type { recommendationSummary } from '@/app/lib/recommendation-service';
import styles from './FriendlyCockpit.module.css';

type Summary=Awaited<ReturnType<typeof recommendationSummary>>;
type Result=Summary['history'][number];
async function read(signal?:AbortSignal,body?:object):Promise<Summary>{
  const response=await fetch('/api/recommendations',{cache:'no-store',signal,
    ...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok||!Array.isArray(data?.rows)||!Array.isArray(data?.history))throw new Error(data.error??'Recommendation assessment unavailable.');
  return data;
}
function Evidence({result}:{result:Result}){
  const {interpretation:i}=result;
  return <details><summary>Supporting evidence, risks and what could change</summary>
    <p>Company case: {i.company} · Valuation: {i.valuation} · Entry: {result.entry}</p>
    <p>Assessment created: {result.createdAt} · Sources checked: {result.collectionCheckedAt??'Unavailable'}</p>
    <p>Recommendation reference: <code>{result.id}</code></p>
    <p>Delayed price date: {result.priceDate??'unavailable'}</p>
    {i.ownershipCondition&&<p>Ownership case under review: {i.ownershipCondition}</p>}
    {i.remainingRationale&&<p>Remaining rationale: {i.remainingRationale}</p>}
    {([['Reason',[i.rationale]],['Supporting',i.supporting],['Contrary',i.contrary],['Risks',i.risks],['Reconsider when',[i.invalidation]]] as const).map(([label,claims])=>
      <section key={label}><h4>{label}</h4><ul>{claims.map((claim,index)=><li key={index}>
        {claim.interpretation}<ul>{claim.evidence.map(id=>{
          const fact=result.facts.find(item=>item.id===id);
          return fact?<li key={id}><a href={fact.url} target="_blank" rel="noreferrer">{fact.period} · {fact.publishedAt||'Publication date unavailable'}</a> — {fact.text}</li>:null;
        })}</ul></li>)}</ul></section>)}
  </details>;
}
export function RecommendationPanel({snapshotDate,symbol}:{snapshotDate:string;symbol?:string}){
  const [data,setData]=useState<Summary|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [checkedAt,setCheckedAt]=useState(0);
  const [expired,setExpired]=useState(false);
  const operation=useRef<{symbol:string;operationId:string}|null>(null);
  const active=useRef<AbortController|null>(null);
  async function load(symbol?:string){
    active.current?.abort();
    const controller=new AbortController();
    active.current=controller;
    setBusy(true);setError('');
    if(symbol&&operation.current?.symbol!==symbol)operation.current={symbol,operationId:crypto.randomUUID()};
    try{
      setData(await read(AbortSignal.any([controller.signal,AbortSignal.timeout(55_000)]),symbol?operation.current??undefined:undefined));
      setCheckedAt(Date.now());setExpired(false);
      if(symbol)operation.current=null;
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not check recommendations.');}
    finally{if(active.current===controller)setBusy(false);}
  }
  useEffect(()=>{
    const controller=new AbortController();
    active.current=controller;
    void read(AbortSignal.any([controller.signal,AbortSignal.timeout(15_000)])).then(value=>{
      if(!controller.signal.aborted){setData(value);setCheckedAt(Date.now());setExpired(false);}
    }).catch(()=>{if(!controller.signal.aborted)setError('Recommendations could not be loaded.');});
    return()=>{controller.abort();active.current?.abort();};
  },[snapshotDate]);
  useEffect(()=>{
    if(!checkedAt)return;
    const timer=setTimeout(()=>setExpired(true),60_000);
    return()=>clearTimeout(timer);
  },[checkedAt]);
  return <section className={styles.section} aria-label="Investment recommendations">
    <div className={styles.sectionHead}><h2>Investment recommendations</h2>
      <button className={styles.textButton} disabled={busy} onClick={()=>void load()}>Refresh assessments</button></div>
    <p className={styles.sectionNote}>Evaluation recommendations use dated evidence. Verify current prices and make any trade yourself.</p>
    {error&&<p role="alert">{error} Earlier results are historical until refreshed.</p>}
    {expired&&<p role="status">Refresh assessments to confirm they are still current.</p>}
    {busy&&<p role="status">Checking recommendations…</p>}
    {!data&&!error&&<p>Loading company assessments…</p>}
    {data&&<><p>Official collection: {data.sourceStatus==='empty'?'Completed with no notices':data.sourceStatus==='content'?'Notices collected':data.sourceStatus==='failed'?'Failed':'Not recorded'}</p>
      {data.coverageMessage&&<p>{data.coverageMessage}</p>}
      {data.rows.filter(row=>!symbol||row.symbol===symbol).map(row=><article className={styles.evidenceGroup} key={row.symbol}>
        <h3>{row.name} · {row.symbol}</h3><p>{row.owned?'Saved holding':'Research shortlist'}</p>
        {(row.blockers.length>0||row.current?.blockers.length)&&<ul>{[...row.blockers,...(row.current?.blockers??[])].map(item=><li key={item}>{item}</li>)}</ul>}
        {row.current&&<><strong>{error||busy||expired?'Previous evaluation':row.current.action?`Evaluation recommendation: ${row.current.action}`:'Assessment blocked'}</strong>
          <p>{row.current.interpretation.rationale.interpretation}</p><Evidence result={row.current}/></>}
        {!row.blockers.length&&!row.current&&<button className={styles.secondaryButton} disabled={busy} onClick={()=>void load(row.symbol)}>Assess {row.name}</button>}
      </article>)}
      {!!data.history.length&&<details><summary>Earlier assessments</summary>{data.history.filter(result=>!symbol||result.symbol===symbol).map(result=><article key={result.id}>
        <h4>{result.symbol} · {result.action??'Blocked'} · {result.createdAt}</h4><Evidence result={result}/>
      </article>)}</details>}
    </>}
  </section>;
}
