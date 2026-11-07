import {afterEach,expect,test,vi} from 'vitest';
import {env} from './cloudflare-workers-stub';
import {PortfolioStore} from '@/app/lib/portfolio-store';
import {buildPortfolioBook,PortfolioConflict,savedPortfolio} from '@/app/lib/portfolio-core.mjs';
import {GET} from '@/app/api/portfolio/route';
import {GET as machine} from '@/app/api/portfolio/current/route';
import {POST} from '@/app/api/portfolio/events/route';
import {POST as preview} from '@/app/api/portfolio/preview/route';

afterEach(()=>{vi.restoreAllMocks();for(const k of Object.keys(env))delete env[k];});
function setup(){env.DB={};env.AGENT_OWNER_EMAIL='owner@example.test';env.DASHBOARD_INGEST_TOKEN='test-only';vi.spyOn(PortfolioStore.prototype,'saved').mockResolvedValue(savedPortfolio([]));vi.spyOn(PortfolioStore.prototype,'soleOwnerId').mockResolvedValue('owner');}
function request(body?:unknown){return new Request('https://example.test/api/portfolio',{method:body?'POST':'GET',headers:{origin:'https://example.test','content-type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},...(body?{body:JSON.stringify(body)}:{})});}
const record={operationId:'open',kind:'event',payload:{kind:'opening_balance',cashSar:0,holdings:[],occurredAt:'2026-10-01T00:00:00.000Z',provenance:{source:'manual'}}};
test('owner routes require an explicit broker and revision and preview cannot append',async()=>{
 setup();const append=vi.spyOn(PortfolioStore.prototype,'appendAccountRecord').mockResolvedValue(buildPortfolioBook([],[]));const read=vi.spyOn(PortfolioStore.prototype,'preview').mockResolvedValue({} as never);
 expect((await GET(request())).status).toBe(200);
 expect((await POST(request({record,expectedRevision:0}))).status).toBe(400);
 expect((await POST(request({accountId:'other',record,expectedRevision:0}))).status).toBe(400);
 expect((await preview(request({accountId:'al_rajhi',record,expectedRevision:0}))).status).toBe(200);
 expect(read).toHaveBeenCalledWith('owner','al_rajhi',record,0);expect(append).not.toHaveBeenCalled();
 append.mockRejectedValue(new PortfolioConflict('refresh'));
 expect((await POST(request({accountId:'al_rajhi',record,expectedRevision:0}))).status).toBe(409);
 delete env.DB;expect((await GET(request())).status).toBe(503);
});
test('machine reads use the bearer boundary and return the one saved portfolio without configuration fallback',async()=>{
 setup();expect((await machine(request())).status).toBe(401);
 const response=await machine(new Request('https://example.test/api/portfolio/current',{headers:{authorization:'Bearer test-only'}}));
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
 const body=await response.json();expect(body.schemaVersion).toBe(3);expect(body.view.holdings).toEqual([]);expect(body.status).toBe('empty');expect(body.view.cashSar).toBeNull();
});
test('operational save and preview failures remain retryable and hide storage details',async()=>{
 setup();
 vi.spyOn(PortfolioStore.prototype,'appendAccountRecord').mockRejectedValue(new Error('D1 private readback failure'));
 vi.spyOn(PortfolioStore.prototype,'preview').mockRejectedValue(new Error('D1 private preview failure'));
 for(const route of [POST,preview]){
  const response=await route(request({accountId:'al_rajhi',record,expectedRevision:0}));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('D1 private');
 }
 const malformed=new Request('https://example.test/api/portfolio',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:'{'});
 expect((await POST(malformed)).status).toBe(400);
});
