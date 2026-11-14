"use client";
import { useEffect, useState } from 'react';
import { decisionActions, type DecisionDraft } from '@/app/lib/copilot-core';
import styles from './FriendlyCockpit.module.css';
import {HoldingSecretary,type SecretaryConversation} from './HoldingSecretary';

type Conversation = SecretaryConversation;
export function CopilotRail() {
  const [conversation,setConversation] = useState<Conversation>({messages:[],decisions:[]});
  const [text,setText] = useState(''), [language,setLanguage] = useState('auto');
  const [error,setError] = useState(''), [busy,setBusy] = useState(false);
  const [draft,setDraft] = useState<(DecisionDraft & {id:string}) | null>(null);
  async function request(body?: unknown, signal?: AbortSignal) {
    const r = await fetch('/api/copilot',{method:body?'POST':'GET',cache:'no-store',signal:signal ?? AbortSignal.timeout(55000),headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
    if (!r.ok) { const message = await r.text(); let detail=message;try{detail=JSON.parse(message).error??message;}catch{}throw Object.assign(new Error(detail),{status:r.status}); }
    const result = await r.json();
    if(!Array.isArray(result.messages)||!Array.isArray(result.decisions))throw new Error('Conversation response is unavailable.');
    return result as Conversation;
  }
  useEffect(()=>{
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(),15000);
    void request(undefined,controller.signal).then(setConversation).catch(()=>{if(!controller.signal.aborted)setError('Conversation could not be loaded. Try again.');}).finally(()=>clearTimeout(timeout));
    return ()=>{clearTimeout(timeout);controller.abort();};
  },[]);
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);setError('');
    try {
      const next=await request({operation:'ask',text,language});
      setConversation(next);setText('');
      const proposed=next.messages.at(-1)?.draft;
      if(proposed)setDraft({...proposed,id:crypto.randomUUID()});
    } catch(e) {setError(e instanceof Error?e.message:'Request failed. Your question is preserved.');}
    finally {setBusy(false);}
  }
  async function confirm() {
    if(!draft || busy)return;
    setBusy(true);setError('');
    try {setConversation(await request({operation:'confirm',confirmed:true,id:draft.id,draft}));setDraft(null);}
    catch(e){setError(e instanceof Error?e.message:'Could not save decision.');}
    finally{setBusy(false);}
  }
  return <aside className={styles.copilotRail} aria-label="TASI copilot">
    {conversation.secretary&&<HoldingSecretary view={conversation.secretary} companies={conversation.holdingCompanies??[]} collection={conversation.collection} request={request} onChange={setConversation}/>}
    <p className={styles.eyebrow}>TASI COPILOT</p><h2>Ask about the whole picture</h2>
    <label>Reply language<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="auto">Automatic</option><option value="en">English</option><option value="ar">العربية</option></select></label>
    <div className={styles.chatHistory} role="log" aria-label="Portfolio conversation" aria-live="polite">{conversation.messages.map(m=><article key={m.id} dir="auto"><strong>{m.role==='user'?'You':'TASI'}</strong><p>{m.text}</p>{m.draft&&<button className={styles.textButton} disabled={busy} onClick={()=>setDraft({...m.draft!,id:crypto.randomUUID()})}>Review decision draft</button>}</article>)}</div>
    {error&&<p role="alert">{error}</p>}
    <form onSubmit={e=>{e.preventDefault();void send();}}><label>Question<textarea dir="auto" value={text} maxLength={4000} onChange={e=>setText(e.target.value)} placeholder="What changed for my holdings?"/></label><button className={styles.primaryButton} disabled={busy||!text.trim()}>{busy?'Working…':'Ask TASI'}</button></form>
    {draft&&<fieldset className={styles.decisionDraft} disabled={busy}><legend>Review decision draft</legend>
      <label>Stock code or PORTFOLIO<input value={draft.symbol} onChange={e=>setDraft({...draft,symbol:e.target.value})}/></label>
      <label>Decision<select value={draft.action} onChange={e=>setDraft({...draft,action:e.target.value as DecisionDraft['action']})}>{decisionActions.map(action=><option key={action}>{action}</option>)}</select></label>
      <label>Conditions<textarea dir="auto" maxLength={2000} value={draft.conditions} onChange={e=>setDraft({...draft,conditions:e.target.value})}/></label>
      <label>Recommendation reference (optional)<input value={draft.recommendationId??''} onChange={e=>setDraft({...draft,recommendationId:e.target.value.trim()||undefined})}/></label>
      <label>Invalidation<textarea dir="auto" maxLength={2000} value={draft.invalidation} onChange={e=>setDraft({...draft,invalidation:e.target.value})}/></label>
      <button className={styles.primaryButton} onClick={()=>void confirm()}>Confirm decision note</button><button className={styles.textButton} onClick={()=>setDraft(null)}>Discard draft</button>
    </fieldset>}
    <details><summary>Saved decisions ({conversation.decisions.length})</summary>{conversation.decisions.map(note=><article key={note.id} dir="auto"><strong>{note.symbol} · {note.action}</strong><p>{note.conditions}</p><p>Invalidation: {note.invalidation}</p><small>{note.confirmedAt}</small><button className={styles.textButton} disabled={busy} onClick={()=>setDraft({...note,id:crypto.randomUUID()})}>Revise decision</button></article>)}</details>
    <small>Confirming saves a decision note. Your holdings change only when you record an executed trade.</small>
  </aside>;
}
