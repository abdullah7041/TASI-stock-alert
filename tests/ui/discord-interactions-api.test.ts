import { afterEach, expect, test, vi } from "vitest";
import { env } from "./cloudflare-workers-stub";

vi.mock("@/app/lib/discord-interactions.mjs", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/app/lib/discord-interactions.mjs")>(),
  verifyDiscordSignature: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/app/lib/copilot-service", () => ({
  answerPortfolioQuestion: vi.fn(),
}));

import { POST } from "@/app/api/discord/interactions/route";
import { answerPortfolioQuestion } from "@/app/lib/copilot-service";
import {PortfolioStore} from '@/app/lib/portfolio-store';
import {savedPortfolio} from '@/app/lib/portfolio-core.mjs';
import {verifyDiscordSignature} from '@/app/lib/discord-interactions.mjs';

test('Discord endpoint verification accepts a signed actorless ping without relaxing owner command access',async()=>{
  env.DISCORD_APP_PUBLIC_KEY='00'.repeat(32);env.DISCORD_OWNER_USER_ID='owner';
  const book=vi.spyOn(PortfolioStore.prototype,'book');
  const request=(body:unknown)=>new Request('https://example.test/api/discord/interactions',{method:'POST',body:JSON.stringify(body)});
  const ping=await POST(request({type:1}));
  expect(ping.status).toBe(200);expect(await ping.json()).toEqual({type:1});
  // Discord discards an HTTP 403 even when its body contains a valid refusal.
  const denied=await POST(request({id:'denied',type:2,user:{id:'other'},data:{name:'portfolio'}}));
  expect(denied.status).toBe(200);
  expect(await denied.json()).toMatchObject({type:4,data:{flags:64,content:expect.stringMatching(/restricted to the portfolio owner/)}});
  expect(book).not.toHaveBeenCalled();
  vi.mocked(verifyDiscordSignature).mockResolvedValueOnce(false);
  expect((await POST(request({type:1}))).status).toBe(401);
});

test('Discord portfolio and budget use dated saved holdings with no setup or sizing',async()=>{
  env.DISCORD_APP_PUBLIC_KEY='00'.repeat(32);env.DISCORD_OWNER_USER_ID='owner';env.PORTFOLIO_OWNER_ID='owner';env.DB={};
  const saved=savedPortfolio([{operationId:'open',kind:'opening_balance',cashSar:300,confirmedAt:'2026-10-08T08:00:00Z'},
    {operationId:'position',kind:'opening_position',code:'2320',name:'Al-Babtain',shares:12,confirmedAt:'2026-10-08T08:00:00Z'}]);
  const read=vi.spyOn(PortfolioStore.prototype,'saved').mockResolvedValue(saved);
  const request=(name:string)=>new Request('https://example.test/api/discord/interactions',{method:'POST',body:JSON.stringify({id:name,type:2,user:{id:'owner'},data:{name}})});
  for(const command of ['portfolio','budget']){
    const result=await (await POST(request(command))).json();
    expect(result.data.content).toMatch(/300.00 SAR recorded cash/);
    expect(result.data.content).toMatch(/Al-Babtain.*12 shares/);
    expect(result.data.content).toMatch(/Last recorded: 2026-10-08/);
    expect(result.data.content).not.toMatch(/Al Rajhi|Al Ahli|opening unconfirmed/);
  }
  read.mockResolvedValue(savedPortfolio([]));
  expect((await (await POST(request('portfolio'))).json()).data.content).toMatch(/Recorded cash unavailable/);
});
test('old Discord trades cannot append to the saved portfolio',async()=>{
  env.DISCORD_APP_PUBLIC_KEY='00'.repeat(32);env.DISCORD_OWNER_USER_ID='owner';env.PORTFOLIO_OWNER_ID='owner';env.DB={};
  const append=vi.spyOn(PortfolioStore.prototype,'appendSaved');
  const request=new Request('https://example.test/api/discord/interactions',{method:'POST',body:JSON.stringify({id:'trade',type:2,user:{id:'owner'},data:{name:'bought'}})});
  const result=await (await POST(request)).json();
  expect(result.data.content).toMatch(/cockpit.*actual fees/i);expect(append).not.toHaveBeenCalled();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of Object.keys(env)) delete env[key];
});

test("Discord /ask reports an assistant outage without claiming the ledger rejected it", async () => {
  env.DISCORD_APP_PUBLIC_KEY = "00".repeat(32);
  env.DISCORD_OWNER_USER_ID = "owner-discord-id";
  env.PORTFOLIO_OWNER_ID = "owner";
  env.OPENROUTER_API_KEY = "test-only";
  env.DB = {};
  vi.mocked(answerPortfolioQuestion).mockRejectedValue(new Response("Assistant provider unavailable (503).", { status: 502 }));
  const interaction = {
    id: "interaction-1",
    type: 2,
    member: { user: { id: "owner-discord-id" } },
    data: { name: "ask", options: [{ name: "question", value: "What changed today?" }] },
  };

  const response = await POST(new Request("https://example.test/api/discord/interactions", {
    method: "POST",
    headers: { "x-signature-ed25519": "00", "x-signature-timestamp": "1" },
    body: JSON.stringify(interaction),
  }));

  expect(response.status).toBe(200);
  const body = await response.json() as { data: { content: string } };
  expect(body.data.content).toMatch(/Discord assistant is temporarily unavailable/i);
  expect(body.data.content).not.toMatch(/ledger rejected/i);
});
