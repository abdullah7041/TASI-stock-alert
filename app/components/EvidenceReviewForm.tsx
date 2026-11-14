"use client";
import { useEffect, useState } from 'react';
import { evidenceMetricFields } from '@/app/lib/evidence-review-core.mjs';
import styles from './FriendlyCockpit.module.css';

type Announcement = {title:string;url:string;retrieved_at?:string;published_at?:string|null;symbol?:string|null};
const localDate=(value?:string|null)=>value&&Number.isFinite(Date.parse(value))?new Date(Date.parse(value)+3*3600_000).toISOString().slice(0,16):'';
type Metric = {raw_value:string;prior_value:string;grade:string;explanation:string;source_url:string};
const label=(key:string)=>key.charAt(0).toUpperCase()+key.slice(1).replaceAll('_',' ');
const emptyMetric=():Metric=>({raw_value:'',prior_value:'',grade:'',explanation:'',source_url:''});
export function EvidenceReviewForm() {
  const [queue,setQueue]=useState<Announcement[]>([]), [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false), [kind,setKind]=useState('operating');
  const [fields,setFields]=useState({symbol:'',companyName:'',sector:'',reportPeriod:'',
    publishedAt:'',retrievedAt:'',sourceName:'Saudi Exchange',sourceUrl:'',analystNotes:'',riskFlags:''});
  const [latestResultsConfirmed,setLatestResultsConfirmed]=useState(false);
  const [notices,setNotices]=useState<Record<string,{status:string;explanation:string}>>({});
  const relevant=queue.filter(item=>fields.symbol&&(item.symbol===fields.symbol||!item.symbol)&&
    (!item.published_at||!fields.publishedAt||Date.parse(item.published_at)>Date.parse(fields.publishedAt+'+03:00')));
  function selectSource(url:string){
    const item=queue.find(row=>row.url===url);
    setLatestResultsConfirmed(false);
    setFields(current=>({...current,sourceUrl:url,symbol:item?.symbol??current.symbol,
      publishedAt:localDate(item?.published_at),retrievedAt:localDate(item?.retrieved_at)}));
  }
  const [metrics,setMetrics]=useState<Record<string,Metric>>({});
  useEffect(()=>{
    const controller=new AbortController();
    void fetch('/api/evidence/queue',{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('Evidence queue is unavailable. You can still enter an official source.');
      const payload=await response.json();
      if(!Array.isArray(payload.announcements))throw new Error('Evidence queue is unavailable. You can still enter an official source.');
      setQueue(payload.announcements);
    }).catch(error=>{if(!controller.signal.aborted)setStatus(error instanceof Error?error.message:'Evidence queue is unavailable.');});
    return()=>controller.abort();
  },[]);
  const change=(field:keyof typeof fields,value:string)=>setFields(current=>({...current,[field]:value}));
  function metricChange(key:string,field:keyof Metric,value:string) {
    setMetrics(current=>({...current,[key]:{...(current[key]??emptyMetric()),[field]:value}}));
  }
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;setBusy(true);setStatus('');
    try {
      const record={...fields,sectorKind:kind,latestResultsConfirmed,
        noticeDispositions:relevant.filter(item=>notices[item.url]?.explanation.trim()).map(item=>({
          url:item.url,title:item.title,publication:item.published_at??null,...notices[item.url],
        })),
        publishedAt:new Date(`${fields.publishedAt}+03:00`).toISOString(),
        retrievedAt:new Date(`${fields.retrievedAt}+03:00`).toISOString(),
        riskFlags:fields.riskFlags.split('\n').map(flag=>flag.trim()).filter(Boolean),
        metrics:Object.fromEntries(evidenceMetricFields(kind).map(key=>{
          const metric=metrics[key]??emptyMetric();
          return [key,{...metric,grade:Number(metric.grade),source_url:metric.source_url.trim()||fields.sourceUrl}];
        }))};
      const response=await fetch('/api/evidence/records',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(record)});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error??'Evidence could not be saved.');
      setStatus('Evidence revision saved. Your portfolio balances are unchanged.');
    } catch(error){setStatus(error instanceof Error?error.message:'Evidence could not be saved.');}
    finally{setBusy(false);}
  }
  return <form className={styles.evidenceForm} onSubmit={submit}>
    <p className={styles.sectionNote}>Enter only reviewed source facts. Every grade requires an explanation and source. Times use Riyadh (UTC+3).</p>
    <fieldset disabled={busy}>
      {queue.length>0&&<label>Choose a collected official source<select value={queue.some(item=>item.url===fields.sourceUrl)?fields.sourceUrl:''}
        onChange={event=>selectSource(event.target.value)}><option value="">Enter a source below</option>
        {queue.map(item=><option key={item.url} value={item.url}>{item.title}</option>)}</select></label>}
      <div className={styles.formGrid}>
        <label>Stock code<input value={fields.symbol} onChange={event=>change('symbol',event.target.value)} pattern="[0-9]{4}" required/></label>
        <label>Company name<input value={fields.companyName} onChange={event=>change('companyName',event.target.value)} required/></label>
        <label>Sector<input value={fields.sector} onChange={event=>change('sector',event.target.value)} required/></label>
        <label>Company type<select value={kind} onChange={event=>setKind(event.target.value)}>
          <option value="operating">Operating company</option><option value="bank">Bank</option><option value="insurer">Insurer</option></select></label>
        <label>Report period<input value={fields.reportPeriod} onChange={event=>change('reportPeriod',event.target.value)} placeholder="2026 H1" required/></label>
        <label>Source name<input value={fields.sourceName} onChange={event=>change('sourceName',event.target.value)} required/></label>
        <label>Published time (Riyadh)<input type="datetime-local" value={fields.publishedAt} onChange={event=>change('publishedAt',event.target.value)} required/></label>
        <label>Retrieved time (Riyadh)<input type="datetime-local" value={fields.retrievedAt} onChange={event=>change('retrievedAt',event.target.value)} required/></label>
      </div>
      <label>Official source URL<input type="url" value={fields.sourceUrl} onChange={event=>change('sourceUrl',event.target.value)} placeholder="https://www.saudiexchange.sa/…" required/></label>
      {evidenceMetricFields(kind).map(key=>{
        const metric=metrics[key]??emptyMetric(),title=label(key);
        return <fieldset className={styles.metricForm} key={key}><legend>{title}</legend><div className={styles.formGrid}>
          <label>{title} · current value<input value={metric.raw_value} onChange={event=>metricChange(key,'raw_value',event.target.value)} required/></label>
          <label>{title} · prior value<input value={metric.prior_value} onChange={event=>metricChange(key,'prior_value',event.target.value)} required/></label>
          <label>{title} · reviewed grade<select value={metric.grade} onChange={event=>metricChange(key,'grade',event.target.value)} required>
            <option value="">Choose a grade</option>{[0,1,2,3,4].map(grade=><option value={grade} key={grade}>{grade}</option>)}</select></label>
          <label>{title} · source URL<input type="url" value={metric.source_url} onChange={event=>metricChange(key,'source_url',event.target.value)} placeholder="Uses the official source above if blank"/></label>
        </div><label>{title} · explanation<textarea value={metric.explanation} onChange={event=>metricChange(key,'explanation',event.target.value)} required/></label></fieldset>;
      })}
      <label><input type="checkbox" checked={latestResultsConfirmed} onChange={e=>setLatestResultsConfirmed(e.target.checked)}/> I checked that this is the latest official financial report for this company</label>
      {relevant.map(item=><fieldset key={item.url}><legend>{item.title}</legend>
        <a href={item.url.startsWith('https://')?item.url:undefined} target="_blank" rel="noreferrer">Read notice</a>
        <label>Notice status<select value={notices[item.url]?.status??'unresolved'} onChange={e=>setNotices({...notices,[item.url]:{status:e.target.value,explanation:notices[item.url]?.explanation??''}})}>
          <option value="unresolved">Unresolved</option><option value="incorporated">Included in reviewed evidence</option><option value="immaterial">Does not change the assessment</option>
        </select></label>
        {notices[item.url]?.status&&notices[item.url].status!=='unresolved'&&<label>Explain how the notice was reviewed
          <textarea required value={notices[item.url].explanation} onChange={e=>setNotices({...notices,[item.url]:{...notices[item.url],explanation:e.target.value}})}/></label>}
      </fieldset>)}
      <label>Risk flags · one per line<textarea value={fields.riskFlags} onChange={event=>change('riskFlags',event.target.value)}/></label>
      <label>Review notes<textarea value={fields.analystNotes} onChange={event=>change('analystNotes',event.target.value)} required/></label>
      <button className={styles.primaryButton} type="submit">{busy?'Saving…':'Save reviewed evidence'}</button>
    </fieldset>
    {status&&<p role="status">{status}</p>}
  </form>;
}
