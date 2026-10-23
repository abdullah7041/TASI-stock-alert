"use client";
import {useRef,useState} from 'react';
import {defaultProfile,type AccountContext,type CaseInput,type HoldingCompany,type HoldingReview,type ProfileInput,type SecretaryView} from '@/app/lib/holding-secretary-core';
import type {CopilotMessage,DecisionNote} from '@/app/lib/copilot-core';
import styles from './FriendlyCockpit.module.css';

export type SecretaryConversation={messages:CopilotMessage[];decisions:DecisionNote[];secretary?:SecretaryView;holdingCompanies?:HoldingCompany[];caseDraft?:CaseInput};
const profileLabels:Record<keyof ProfileInput,string>={objective:'Investment objective',horizon:'Investment horizon',contributions:'Contributions',riskSettings:'Risk settings',constraints:'Constraints'};
const caseLabels:Record<Exclude<keyof CaseInput,'symbol'|'sourceRefs'>,string>={reasons:'Reasons for holding',supportingEvidence:'Supporting evidence',risks:'Risks',reconsiderWhen:'When to reconsider'};
function Accounts({accounts}:{accounts:AccountContext[]}){
  return <ul>{accounts.map(a=><li key={a.accountId}>{a.accountId==='al_rajhi'?'Al Rajhi':a.accountId==='al_ahli'?'Al Ahli':a.accountId} · {a.shares} shares · revision {a.revision}</li>)}</ul>;
}
function Sources({refs,dated=false,sources}:{refs:string[];dated?:boolean;sources?:HoldingReview['sources']}){
  const urls=refs.map(ref=>ref.trim()).filter(Boolean);
  return urls.length?<ul>{urls.map((url,i)=>{
    const source=sources?.find(item=>item.url===url);
    return <li key={`${url}-${i}`}>{/^https?:\/\//i.test(url)?<a href={url} target="_blank" rel="noopener noreferrer">{url}</a>:<span>{url}</span>}
      {dated&&<><p>Published: {source?.publishedAt??'unknown'} · Retrieved: {source?.retrievedAt??'unknown'} · Reviewed: {source?.reviewedAt??'unknown'}</p>{source?.kind==='announcement'&&<p>Title only. Read the source before drawing financial conclusions.</p>}</>}
    </li>;
  })}</ul>:<p>No supporting source references recorded.</p>;
}

export function HoldingSecretary({view,companies,request,onChange}:{view:SecretaryView;companies:HoldingCompany[];request:(body?:unknown)=>Promise<SecretaryConversation>;onChange:(next:SecretaryConversation)=>void}){
  const [profile,setProfile]=useState<ProfileInput>(()=>view.profile??{...defaultProfile});
  const [symbol,setSymbol]=useState(''),[draft,setDraft]=useState<CaseInput|null>(null);
  const [draftProfileRevision,setDraftProfileRevision]=useState(0),[draftRevision,setDraftRevision]=useState(0);
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState(''),[conflict,setConflict]=useState(false);
  const profileSave=useRef<Record<string,unknown>|null>(null),caseSave=useRef<Record<string,unknown>|null>(null);
  const acknowledgeIds=useRef<Record<string,string>>({});
  const company=companies.find(c=>c.symbol===symbol),currentCase=view.cases.find(c=>c.symbol===symbol);
  async function run(operation:string,body?:unknown){
    if(busy)return null;
    setBusy(operation);setError('');setMessage('');
    try{const next=await request(body);onChange(next);return next;}
    catch(e){
      const stale=typeof e==='object'&&e!==null&&'status' in e&&e.status===409;
      if(stale)setConflict(true);
      setError(`${e instanceof Error?e.message:'Request failed. Your draft is preserved.'}${stale?' Refresh saved context, review your draft, and confirm again.':''}`);
      return null;
    }finally{setBusy('');}
  }
  async function saveProfile(){
    profileSave.current??={operation:'save_profile',profile:{objective:profile.objective,horizon:profile.horizon,contributions:profile.contributions,riskSettings:profile.riskSettings,constraints:profile.constraints},expectedRevision:view.profile?.revision??0,operationId:crypto.randomUUID()};
    if(await run('profile',profileSave.current)){profileSave.current=null;setMessage('Investor profile confirmed.');}
  }
  async function draftCase(){
    const next=await run('draft',{operation:'draft_case',symbol});
    if(next?.caseDraft){setDraft(next.caseDraft);setDraftProfileRevision(view.profile?.revision??0);setDraftRevision(currentCase?.revision??0);caseSave.current=null;}
  }
  async function confirmCase(){
    if(!draft)return;
    caseSave.current??={operation:'confirm_case',case:{...draft,sourceRefs:draft.sourceRefs.map(ref=>ref.trim()).filter(Boolean)},expectedRevision:draftRevision,profileRevision:draftProfileRevision,operationId:crypto.randomUUID()};
    if(await run('case',caseSave.current)){caseSave.current=null;setDraft(null);setMessage('Company case confirmed. Holdings were not changed.');}
  }
  async function refresh(){
    const next=await run('refresh');
    if(next?.secretary){
      setConflict(false);profileSave.current=null;caseSave.current=null;
      setDraftRevision(next.secretary.cases.find(c=>c.symbol===symbol)?.revision??0);
      setDraftProfileRevision(next.secretary.profile?.revision??0);
      setMessage('Saved context refreshed. Your edits are preserved; review them before confirming.');
    }
  }
  return <section className={styles.section} aria-label="Holdings secretary"><h2>Holdings secretary</h2>
    <p>Confirm your profile, then review a case for a company you already hold. Cases record your judgement; reviews remain provisional. No orders are sent.</p>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {busy&&<p role="status">{busy==='draft'?'Preparing company draft…':busy==='review'?'Checking holding evidence…':busy==='refresh'?'Loading saved context…':'Saving…'}</p>}
    {conflict&&<button className={styles.secondaryButton} disabled={Boolean(busy)} onClick={()=>void refresh()}>Refresh saved context</button>}
    {view.profile&&<section className={styles.evidenceGroup} aria-label="Confirmed investor profile" aria-live="polite"><h3>Confirmed investor profile · revision {view.profile.revision}</h3><p>Company cases use this saved profile. Confirmed {view.profile.confirmedAt}.</p><dl>{(Object.keys(profileLabels) as (keyof ProfileInput)[]).map(field=><div key={field}><dt>{profileLabels[field]}</dt><dd dir="auto">{view.profile![field]}</dd></div>)}</dl></section>}
    <form onSubmit={e=>{e.preventDefault();void saveProfile();}}><fieldset className={styles.decisionDraft} disabled={Boolean(busy)}><legend>1. Investor profile</legend>
      <p>{view.profile?`Profile revision ${view.profile.revision} · confirmed ${view.profile.confirmedAt}`:'Suggested starting text is unconfirmed. Edit every field to match your circumstances.'}</p>
      {view.profile&&<p>Editable profile fields may contain unsaved changes. Review the confirmed profile above before confirming a company case.</p>}
      {(Object.keys(profileLabels) as (keyof ProfileInput)[]).map(field=><label key={field}>{profileLabels[field]}<textarea dir="auto" value={profile[field]} maxLength={4000} required onChange={e=>{setProfile({...profile,[field]:e.target.value});profileSave.current=null;}}/></label>)}
      <button className={styles.primaryButton} disabled={conflict}>Confirm investor profile</button>
    </fieldset></form>
    <h3>2. Company case</h3>
    {!companies.length?<p className={styles.notice}>Confirmed holdings are unavailable. Confirm a broker opening snapshot or resolve its account history before creating a company case.</p>:<>
      <label>Confirmed holding<select value={symbol} disabled={Boolean(busy)||!view.profile} onChange={e=>{setSymbol(e.target.value);setDraft(null);caseSave.current=null;}}><option value="">Select a confirmed holding</option>{companies.map(c=><option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}</select></label>
      {!view.profile&&<p>Confirm your investor profile before drafting a company case.</p>}
      {company&&<><Accounts accounts={company.accounts}/><button className={styles.secondaryButton} disabled={Boolean(busy)||conflict} onClick={()=>void draftCase()}>Draft company case</button>
        <button className={styles.textButton} disabled={Boolean(busy)||conflict} onClick={()=>{setDraft({symbol,reasons:'',supportingEvidence:'',risks:'',reconsiderWhen:'',sourceRefs:[]});setDraftRevision(currentCase?.revision??0);setDraftProfileRevision(view.profile!.revision);caseSave.current=null;setError('');}}>Write company case</button>
        {currentCase&&<><p>Confirmed case revision {currentCase.revision} · profile revision {currentCase.profileRevision} · {currentCase.confirmedAt}</p><button className={styles.textButton} disabled={Boolean(busy)||conflict} onClick={()=>{setDraft({...currentCase});setDraftRevision(currentCase.revision);setDraftProfileRevision(view.profile!.revision);caseSave.current=null;}}>Revise confirmed case</button><button className={styles.secondaryButton} disabled={Boolean(busy)||conflict} onClick={()=>void run('review',{operation:'review_holding',symbol})}>Review holding evidence</button></>}
      </>}
    </>}
    {draft&&<form onSubmit={e=>{e.preventDefault();void confirmCase();}}><fieldset className={styles.decisionDraft} disabled={Boolean(busy)}><legend>Review company case · {draft.symbol}</legend><p>Unconfirmed draft · profile revision {draftProfileRevision}. Check the evidence and edit before confirming.</p>
      {(Object.keys(caseLabels) as (keyof typeof caseLabels)[]).map(field=><label key={field}>{caseLabels[field]}<textarea dir="auto" value={draft[field]} maxLength={4000} required onChange={e=>{setDraft({...draft,[field]:e.target.value});caseSave.current=null;}}/></label>)}
      <label>Supporting source references (one per line)<textarea value={draft.sourceRefs.join('\n')} maxLength={16000} onChange={e=>{setDraft({...draft,sourceRefs:e.target.value.split('\n')});caseSave.current=null;}}/></label>
      <Sources refs={draft.sourceRefs}/><button className={styles.primaryButton} disabled={conflict}>Confirm company case</button><button type="button" className={styles.textButton} onClick={()=>{setDraft(null);caseSave.current=null;}}>Discard company draft</button>
    </fieldset></form>}
    <h3>3. Evidence reviews</h3><p>Acknowledging a review records that you read it. It does not revise your company case or holdings.</p>
    {!view.reviews.length&&<p>No holding reviews saved yet.</p>}
    {view.reviews.map(review=><article key={review.id} className={styles.evidenceGroup} aria-label={`${review.symbol} review`}><h4>{review.symbol} · {review.status} · {review.action}</h4><p>Created <time dateTime={review.createdAt}>{review.createdAt}</time> · case revision {review.caseRevision} · profile revision {review.profileRevision}</p>
      <Accounts accounts={review.accounts}/>{(['changed','supporting','contrary','implications','missing','questions'] as const).map(field=><p dir="auto" key={field}><strong>{field.charAt(0).toUpperCase()+field.slice(1)}: </strong>{review[field]||'Not available'}</p>)}
      <p>Source dates are separate from the review creation time.</p><Sources refs={review.sourceRefs} dated sources={review.sources}/>
      <details><summary>Review provenance</summary><p>Collection run: {review.collectionRunId??'unknown'}</p><p>Evidence revisions: {review.evidenceRevisions?.join(', ')||'unknown'}</p></details>
      {view.acknowledgedReviewIds.includes(review.id)?<p>Acknowledged</p>:<button className={styles.secondaryButton} disabled={Boolean(busy)} onClick={()=>{acknowledgeIds.current[review.id]??=crypto.randomUUID();void run('acknowledge',{operation:'acknowledge_review',reviewId:review.id,operationId:acknowledgeIds.current[review.id]});}}>Acknowledge review</button>}
    </article>)}
    <details><summary>Case history ({view.caseHistory.length})</summary>{view.caseHistory.map(item=><article className={styles.evidenceGroup} key={`${item.symbol}-${item.revision}`}><h4>{item.symbol} · revision {item.revision}</h4><p>Confirmed <time dateTime={item.confirmedAt}>{item.confirmedAt}</time> · profile revision {item.profileRevision}</p>{(Object.keys(caseLabels) as (keyof typeof caseLabels)[]).map(field=><p key={field} dir="auto"><strong>{caseLabels[field]}: </strong>{item[field]}</p>)}<Sources refs={item.sourceRefs}/></article>)}</details>
  </section>;
}
