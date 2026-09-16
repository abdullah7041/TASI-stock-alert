import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseDecision, parseCopilotReply } from '@/app/lib/copilot-core';
import { CopilotRail } from '@/app/components/CopilotRail';
import { env } from './cloudflare-workers-stub';
import { GET, POST } from '@/app/api/copilot/route';

const draft={symbol:'1303',action:'WATCH',conditions:'Watch volume',invalidation:'Thesis no longer supported'};
afterEach(()=>{cleanup();vi.unstubAllGlobals();for(const key of Object.keys(env))delete env[key];});
test('requires conditions and invalidation and excludes execution actions',()=>{
  expect(parseDecision(draft)).toEqual(draft);
  expect(()=>parseDecision({...draft,action:'BUY'})).toThrow();
  expect(()=>parseDecision({...draft,invalidation:''})).toThrow();
  expect(parseCopilotReply(JSON.stringify({answer:'Evidence is delayed.',draft:null})).draft).toBeNull();
});
test('rejects missing owner identity before storage access',async()=>{
  expect((await GET(new Request('https://example.test/api/copilot'))).status).toBe(401);
});
test('rejects decision persistence without explicit confirmation',async()=>{
  env.AGENT_OWNER_EMAIL='owner@example.test';env.DB={};
  const r=await POST(new Request('https://example.test/api/copilot',{method:'POST',headers:{origin:'https://example.test','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test','content-type':'application/json'},body:JSON.stringify({operation:'confirm',draft,id:crypto.randomUUID()})}));
  expect(r.status).toBe(400);
});
test('a proposed decision is editable and persisted only by the confirmation button',async()=>{
  const conversation={messages:[{id:'reply',role:'assistant',text:'Consider watching EIC.',draft,createdAt:'2026-09-16T10:00:00Z'}],decisions:[]};
  const fetcher=vi.fn(async(_url:unknown,options?:RequestInit)=>Response.json(options?.method==='POST'?{messages:conversation.messages,decisions:[{...draft,id:'saved',confirmedAt:'2026-09-16T10:01:00Z'}]}:conversation));
  vi.stubGlobal('fetch',fetcher);
  render(<CopilotRail/>);
  await userEvent.click(await screen.findByRole('button',{name:'Review decision draft'}));
  expect(fetcher.mock.calls.filter(([,o])=>o?.method==='POST')).toHaveLength(0);
  await userEvent.clear(screen.getByLabelText('Conditions'));
  await userEvent.type(screen.getByLabelText('Conditions'),'Wait for stronger evidence');
  await userEvent.click(screen.getByRole('button',{name:'Confirm decision note'}));
  const sent=JSON.parse(String(fetcher.mock.calls.find(([,o])=>o?.method==='POST')?.[1]?.body));
  expect(sent.confirmed).toBe(true);
  expect(sent.draft.conditions).toBe('Wait for stronger evidence');
  expect(await screen.findByText('Saved decisions (1)')).toBeTruthy();
});
test('preserves a question when the provider fails',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_url,options)=>options?.method==='POST'?new Response('Provider unavailable',{status:502}):Response.json({messages:[],decisions:[]})));
  render(<CopilotRail/>);
  await userEvent.type(screen.getByLabelText('Question'),'Why did EIC move?');
  await userEvent.click(screen.getByRole('button',{name:'Ask TASI'}));
  expect((await screen.findByRole('alert')).textContent).toContain('Provider unavailable');
  expect((screen.getByLabelText('Question') as HTMLTextAreaElement).value).toBe('Why did EIC move?');
});
