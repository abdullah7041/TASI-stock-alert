"use client";
import {useRef,useState} from 'react';
import type {AccountEventPayload,AccountPreview,AccountRecordInput,BrokerAccountId,PortfolioAccountView,PortfolioBook} from '@/app/lib/evidence-types';
import styles from './FriendlyCockpit.module.css';

export const brokerName=(id:BrokerAccountId)=>id==='al_rajhi'?'Al Rajhi':'Al Ahli';
const money=(n:number|null)=>n===null?'Unconfirmed':`${n.toFixed(2)} SAR`;
type HoldingRow={code:string;name:string;shares:string;avgCostSar:string};
const emptyRow=():HoldingRow=>({code:'',name:'',shares:'',avgCostSar:''});

export function AccountRecordForm({account,onSaved,tradeOnly=false}:{account:PortfolioAccountView;onSaved:()=>void;tradeOnly?:boolean}) {
  const [activity,setActivity]=useState(tradeOnly?'buy':account.initialized?'contribution':'opening_balance');
  const [eventKind,setEventKind]=useState<AccountEventPayload['kind']>('contribution');
  const [amount,setAmount]=useState(''),[time,setTime]=useState(''),[reference,setReference]=useState('');
  const [code,setCode]=useState(''),[name,setName]=useState(''),[shares,setShares]=useState(''),[price,setPrice]=useState(''),[fees,setFees]=useState('');
  const [rows,setRows]=useState<HoldingRow[]>([]),[target,setTarget]=useState(''),[reason,setReason]=useState(''),[voided,setVoided]=useState(false);
  const [preview,setPreview]=useState<{envelope:{accountId:BrokerAccountId;record:AccountRecordInput;expectedRevision:number};result:AccountPreview}|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [saveUncertain,setSaveUncertain]=useState(false);
  const operation=useRef<string|null>(null);
  const kind=activity==='correction'?eventKind:activity;
  const trade=kind==='buy'||kind==='sell';
  const positions=kind==='opening_balance'||activity==='reconciliation';
  function invalidate(){operation.current=null;setPreview(null);setSaveUncertain(false);setMessage('');}
  function eventPayload():AccountEventPayload {
    const occurredAt=new Date(`${time}+03:00`).toISOString();
    const base={kind:kind as AccountEventPayload['kind'],occurredAt,provenance:{source:'manual' as const,...(reference.trim()?{reference:reference.trim()}:{})}};
    if(trade)return {...base,code,name:account.holdings.find(h=>h.code===code)?.name??name,shares:Number(shares),priceSar:Number(price),feesSar:Number(fees)};
    return {...base,cashSar:Number(amount),...(kind==='opening_balance'?{holdings:rows.map(h=>({code:h.code,name:h.name,shares:Number(h.shares),...(h.avgCostSar===''?{}:{avgCostSar:Number(h.avgCostSar)})}))}:{})};
  }
  async function submit(confirm:boolean){
    if(busy)return;setBusy(true);setMessage('');
    try {
      let envelope=preview?.envelope;
      if(!confirm){
        operation.current??=crypto.randomUUID();
        let record:AccountRecordInput;
        if(activity==='reconciliation')record={operationId:operation.current,kind:'reconciliation',payload:{statementAsOf:new Date(`${time}+03:00`).toISOString(),cashSar:Number(amount),holdings:rows.map(h=>({code:h.code,shares:Number(h.shares)})),reference}};
        else if(activity==='correction')record={operationId:operation.current,kind:'correction',payload:{targetOperationId:target,replacement:voided?null:eventPayload(),reason}};
        else record={operationId:operation.current,kind:'event',payload:eventPayload()};
        envelope={accountId:account.accountId,record,expectedRevision:account.revision};
      }
      if(!envelope)throw new Error('Preview the record first.');
      if(confirm)setSaveUncertain(true);
      const response=await fetch(`/api/portfolio/${confirm?'events':'preview'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)});
      const body=await response.json();
      if(!response.ok){if(response.status<500)setSaveUncertain(false);if(response.status===409){setPreview(null);onSaved();}throw new Error(body.error??'The account record could not be saved.');}
      if(confirm){setPreview(null);setSaveUncertain(false);operation.current=null;setAmount('');setShares('');setPrice('');setFees('');setTime('');setRows([]);setMessage('Account record confirmed. No order was sent.');onSaved();}
      else setPreview({envelope,result:body});
    } catch(e){setMessage(e instanceof Error?e.message:'Account request failed.');}finally{setBusy(false);}
  }
  const readyPreview=preview&&(preview.envelope.expectedRevision===account.revision||saveUncertain);
  return <form className={styles.tradeForm} onSubmit={e=>{e.preventDefault();void submit(false);}}>
    <p>{brokerName(account.accountId)} · Record only activity already completed in your broker. Saudi main-market individual stocks only.</p>
    <fieldset disabled={busy||Boolean(account.error)} onChange={invalidate}>
      <label>{tradeOnly?'Action':'Activity'}<select value={activity} onChange={e=>setActivity(e.target.value)}>
        {tradeOnly?<><option value="buy">Bought</option><option value="sell">Sold</option></>:<><option value="opening_balance">Opening snapshot</option><option value="contribution">Deposit</option><option value="withdrawal">Withdrawal</option><option value="dividend">Dividend</option><option value="fee">Standalone fee</option><option value="buy">Bought</option><option value="sell">Sold</option><option value="correction">Correction / void</option><option value="reconciliation">Statement comparison</option></>}
      </select></label>
      {activity==='correction'&&<><label>Original event<select value={target} onChange={e=>setTarget(e.target.value)} required><option value="">Select event</option>{account.records.filter(r=>r.kind==='event').map(r=><option key={r.operationId} value={r.operationId}>{r.operationId} · {r.kind==='event'?r.payload.kind:''}</option>)}</select></label><label>Correction reason<input value={reason} onChange={e=>setReason(e.target.value)} required/></label><label><input type="checkbox" checked={voided} onChange={e=>setVoided(e.target.checked)}/>Void original event</label>{!voided&&<label>Replacement activity<select value={eventKind} onChange={e=>setEventKind(e.target.value as AccountEventPayload['kind'])}>{['opening_balance','contribution','withdrawal','dividend','fee','buy','sell'].map(k=><option key={k} value={k}>{k}</option>)}</select></label>}</>}
      {!(activity==='correction'&&voided)&&<>
        <label>{activity==='reconciliation'?'Statement time (Riyadh)':'Transaction time (Riyadh)'}<input type="datetime-local" value={time} onChange={e=>setTime(e.target.value)} required/></label>
        {trade?<><label>Stock code<input pattern="[0-9]{4}" value={code} onChange={e=>setCode(e.target.value)} required/></label>{!account.holdings.some(h=>h.code===code)&&<label>Company name<input value={name} onChange={e=>setName(e.target.value)} required/></label>}<label>Executed shares<input type="number" min="1" step="1" value={shares} onChange={e=>setShares(e.target.value)} required/></label><label>Execution price (SAR)<input type="number" min="0.0001" step="any" value={price} onChange={e=>setPrice(e.target.value)} required/></label><label>Fees (SAR)<input type="number" min="0" step="any" value={fees} onChange={e=>setFees(e.target.value)} required/></label></>:<label>Amount (SAR)<input type="number" min={kind==='opening_balance'||activity==='reconciliation'?'0':'0.01'} step="any" value={amount} onChange={e=>setAmount(e.target.value)} required/></label>}
        <label>{activity==='reconciliation'?'Statement reference':'Receipt reference (optional)'}<input value={reference} onChange={e=>setReference(e.target.value)} required={activity==='reconciliation'}/></label>
        {positions&&<div><p>{activity==='reconciliation'?'Statement positions':'Opening positions'} · Leave empty for no holdings. Unknown cost stays blank.</p>{rows.map((h,i)=><div className={styles.accountRow} key={i}>{(['code',...(activity==='reconciliation'?[]:['name']),'shares',...(activity==='reconciliation'?[]:['avgCostSar'])] as (keyof HoldingRow)[]).map(field=><label key={field}>{field} {i+1}<input value={h[field]} type={field==='shares'||field==='avgCostSar'?'number':'text'} min={field==='shares'?'1':'0.0001'} step={field==='shares'?'1':'any'} pattern={field==='code'?'[0-9]{4}':undefined} required={field!=='avgCostSar'} onChange={e=>setRows(rows.map((row,j)=>i===j?{...row,[field]:e.target.value}:row))}/></label>)}<button type="button" onClick={()=>{invalidate();setRows(rows.filter((_,j)=>i!==j));}}>Remove position {i+1}</button></div>)}<button type="button" onClick={()=>{invalidate();setRows([...rows,emptyRow()]);}}>Add position</button></div>}
      </>}
      <button className={styles.primaryButton} type="submit" disabled={saveUncertain}>{busy?'Checking…':'Preview record'}</button>
    </fieldset>
    {preview&&!readyPreview&&<p role="status">Account revision changed. Preview again before confirmation.</p>}
    {readyPreview&&<section aria-label="Record preview"><h3>Preview · {brokerName(account.accountId)}</h3>{saveUncertain?<p>Confirmation response unavailable. Retry the same record; it will only be recorded once.</p>:<><p>Cash before {money(account.cashSar)} → after {money(preview.result.projected.cashSar)}</p><p>Holdings before: {account.holdings.map(h=>`${h.code}: ${h.shares}`).join(', ')||'none'}. After: {preview.result.projected.holdings.map(h=>`${h.code}: ${h.shares}`).join(', ')||'none'}.</p>{trade&&<p>Actual trade fees: {fees} SAR</p>}<p>{preview.result.projected.discrepancies.map(d=>`${d.code??d.field}: statement minus ledger ${d.difference}`).join('; ')||'No statement discrepancies in this projection.'}</p></>}<details><summary>Record details</summary><pre>{JSON.stringify(preview.envelope.record,null,2)}</pre></details><button className={styles.primaryButton} type="button" disabled={busy||Boolean(account.error)} onClick={()=>void submit(true)}>{saveUncertain?'Retry confirmation':'Confirm record'}</button></section>}
    <p role="status">{message}</p>
  </form>;
}

export function PortfolioAccounts({book,accountId,onAccountChange,onSaved,prices=[]}:{book:PortfolioBook;accountId:BrokerAccountId|null;onAccountChange:(id:BrokerAccountId|null)=>void;onSaved:()=>void;prices?:Array<{code:string;price:number;asOf:string}>}) {
  const account=book.accounts.find(a=>a.accountId===accountId);
  const holdings=account?account.holdings:book.accounts.flatMap(a=>a.holdings);
  const valued=holdings.map(h=>({holding:h,quote:prices.find(p=>p.code===h.code&&p.price>0)}));
  const valueComplete=(account?account.initialized:book.combined.complete)&&valued.every(v=>v.quote);
  const total=valued.reduce((n,v)=>n+v.holding.shares*(v.quote?.price??0),0);
  return <section className={styles.section} aria-label="Broker accounts"><h2>Broker accounts</h2><p>Al Rajhi and Al Ahli are independent. Combined totals are reporting only.</p>
    <div className={styles.grid}>{book.accounts.map(a=><article key={a.accountId} className={styles.accountSummary}><h3>{brokerName(a.accountId)}</h3><p>{a.error??money(a.cashSar)} cash</p><p>Confirmed: {a.confirmedAt??'not confirmed'}</p><p>Reconciliation: {a.reconciliationStatus} · checked {a.lastReconciledAt??'never'} · statement {a.reconciliationStatementAsOf??'none'}</p>{a.discrepancies.map(d=><p key={`${d.field}${d.code}`}>{d.code??'Cash'}: ledger {d.ledger}, statement {d.statement}, difference {d.difference}</p>)}<p>{a.historyComplete?'History starts from confirmed empty holdings.':'Opening snapshot is the history boundary; earlier performance is unavailable.'}</p><p>Realised gain since opening: {a.realisedSar===null?'unavailable':money(a.realisedSar)}</p></article>)}</div>
    <p>{book.combined.cashSar===null?'Combined cash incomplete':`${book.combined.cashSar.toFixed(2)} SAR combined cash`} · reporting only; never a spending pool.</p>
    <label>View account<select value={accountId??''} onChange={e=>onAccountChange((e.target.value||null) as BrokerAccountId|null)}><option value="">Combined reporting</option><option value="al_rajhi">Al Rajhi</option><option value="al_ahli">Al Ahli</option></select></label>
    <p>Holding value: {valueComplete?money(total):'incomplete; quotes or account openings unavailable'}. {valued.filter(v=>v.quote).map(v=>`${v.holding.code}: ${money(v.holding.shares*v.quote!.price)} (${v.quote!.asOf})${valueComplete&&total>0?` · ${(v.holding.shares*v.quote!.price/total*100).toFixed(1)}% of holding value`:''}`).join('; ')}</p>
    <p>Sizing policy and fee assumptions are not configured.</p>
    {account?<>{!account.error&&<AccountRecordForm key={account.accountId} account={account} onSaved={onSaved}/>}<details><summary>{brokerName(account.accountId)} immutable history ({account.records.length})</summary>{account.records.map(r=><article key={r.operationId}><p>Revision {r.revision} · recorded {r.recordedAt} · {r.operationId}</p><pre>{JSON.stringify(r,null,2)}</pre></article>)}</details></>:<p>Select a broker account to record activity.</p>}
    <details><summary>Unassigned legacy history ({book.legacy.events.length})</summary><p>These records have no confirmed broker assignment and are excluded from account balances.</p><pre>{JSON.stringify(book.legacy.events,null,2)}</pre></details>
  </section>;
}
