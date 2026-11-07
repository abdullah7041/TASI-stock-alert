import { afterEach, expect, test, vi } from 'vitest';
import { env } from './cloudflare-workers-stub';
import { POST } from '@/app/api/copilot/route';
import { CopilotStore } from '@/app/lib/copilot-store';
import { ResearchStore } from '@/app/lib/research-store';
import { DashboardStore } from '@/app/lib/dashboard-store';
import { PortfolioStore } from '@/app/lib/portfolio-store';
import { MarketPulseStore } from '@/app/lib/market-pulse-store';
import { AlertStore } from '@/app/lib/alert-store';
import {savedPortfolio} from '@/app/lib/portfolio-core.mjs';
import { HoldingSecretaryStore } from '@/app/lib/holding-secretary-store';
import { EvidenceStore } from '@/app/lib/evidence-store';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const key of Object.keys(env))delete env[key];});
function setup() {
  env.AGENT_OWNER_EMAIL='owner@example.test';env.OPENROUTER_API_KEY='test-only';env.AGENT_DEFAULT_MODEL='deepseek/deepseek-v4.1-flash';env.DB={};
  vi.spyOn(DashboardStore.prototype,'latest').mockResolvedValue(null);
  vi.spyOn(PortfolioStore.prototype,'saved').mockResolvedValue(savedPortfolio([]));
  vi.spyOn(MarketPulseStore.prototype,'latest').mockResolvedValue(null);
  vi.spyOn(AlertStore.prototype,'latest').mockResolvedValue([]);
  vi.spyOn(CopilotStore.prototype,'history').mockResolvedValue({messages:[],decisions:[]});
  vi.spyOn(HoldingSecretaryStore.prototype,'view').mockResolvedValue({profile:null,cases:[],caseHistory:[],reviews:[],acknowledgedReviewIds:[]});
  vi.spyOn(EvidenceStore.prototype,'currentWithRevisions').mockResolvedValue([]);
  vi.spyOn(EvidenceStore.prototype,'latestCollection').mockResolvedValue(null);
  vi.spyOn(EvidenceStore.prototype,'queue').mockResolvedValue([]);
  vi.spyOn(ResearchStore.prototype,'reserve').mockResolvedValue('reserved');
  const save=vi.spyOn(CopilotStore.prototype,'saveMessages').mockResolvedValue();
  const confirm=vi.spyOn(CopilotStore.prototype,'confirm').mockResolvedValue();
  const trade=vi.spyOn(PortfolioStore.prototype,'appendAccountRecord');
  return {save,confirm,trade};
}
function request(body:unknown) {
  return new Request('https://example.test/api/copilot',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify(body)});
}
test('answers from the current ledger even without a daily snapshot and never confirms a model draft',async()=>{
  const {save,confirm,trade}=setup();
  const draft={symbol:'PORTFOLIO',action:'WATCH',conditions:'Wait for fresh data',invalidation:'Updated evidence changes the view'};
  let fetched: { url: string; init?: RequestInit } | undefined;
  const fetcher=vi.fn(async(url: RequestInfo | URL, init?: RequestInit)=>{fetched={url:String(url),init};return Response.json({output_text:JSON.stringify({answer:'Cash is 200 SAR. Market data is missing.',draft})});});
  vi.stubGlobal('fetch',fetcher);
  expect((await POST(request({operation:'ask',text:'Review my portfolio',language:'en'}))).status).toBe(200);
  const options=fetched?.init;
  expect(fetched?.url).toBe('https://openrouter.ai/api/v1/responses');
  if (!options) throw new Error('Expected the assistant request options to be captured.');
  const sent=JSON.parse(String(options.body));
  expect(sent.model).toBe('deepseek/deepseek-v4.1-flash');
  expect(sent.provider).toEqual({require_parameters:true});
  expect(JSON.parse(sent.input).evidence.portfolio.view.cashSar).toBeNull();
  expect(sent.instructions).toMatch(/saved portfolio ledger/i);
  expect(JSON.parse(sent.input).evidence.freshness).toBe('missing');
  expect(save.mock.calls[0][1].map(m=>m.role)).toEqual(['user','assistant']);
  expect(save.mock.calls[0][1][1].draft).toEqual(draft);
  expect(confirm).not.toHaveBeenCalled();expect(trade).not.toHaveBeenCalled();
});
test('budget exhaustion prevents dispatch and conversation writes',async()=>{
  const {save}=setup();
  vi.spyOn(ResearchStore.prototype,'reserve').mockResolvedValue('exhausted');
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect((await POST(request({operation:'ask',text:'Review my portfolio'}))).status).toBe(429);
  expect(fetcher).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
test('confirmation works without an AI key and writes only the owner decision note',async()=>{
  const {confirm,trade}=setup();delete env.OPENROUTER_API_KEY;
  const draft={symbol:'1303',action:'HOLD',conditions:'Evidence holds',invalidation:'Evidence deteriorates'};
  expect((await POST(request({operation:'confirm',confirmed:true,id:crypto.randomUUID(),draft}))).status).toBe(200);
  expect(confirm.mock.calls[0][0]).toBe('owner');expect(confirm.mock.calls[0][1].conditions).toBe('Evidence holds');
  expect(trade).not.toHaveBeenCalled();
});
