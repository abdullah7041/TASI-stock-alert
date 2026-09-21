import { afterEach, expect, test, vi } from "vitest";
import { env } from "./cloudflare-workers-stub";
import { ResearchStore } from "@/app/lib/research-store";

// `cloudflare:workers` is aliased to ./cloudflare-workers-stub.ts in
// vitest.config.ts. It must be an alias rather than a `vi.mock`: Vite resolves
// imports at transform time, before mock factories run, so a vi.mock here fails
// with "Failed to resolve import" and the suite never loads at all.
const { createOrReuseReport, getPrivateResearchContext } = await import("@/app/lib/research-agent");

const ownerHeaders = {
  "oai-authenticated-user-id": "user-123",
  "oai-authenticated-user-email": "owner@example.com",
};

function requestWith(headers: Record<string, string>) {
  return new Request("https://example.com/api/portfolio", { headers });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of Object.keys(env)) delete env[key];
});

test("Sites-authenticated owner identity resolves an OpenRouter context with one default model", async () => {
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENROUTER_API_KEY = "or-test";
  env.AGENT_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
  env.AGENT_CHAT_MODEL = "old-chat-model";
  env.AGENT_REPORT_MODEL = "old-report-model";

  const request = requestWith({ ...ownerHeaders });

  const context = await getPrivateResearchContext(request);
  expect(context.ownerId).toBe("user-123");
  expect(context.apiKey).toBe("or-test");
  expect(context.chatModel).toBe("deepseek/deepseek-v4.1-flash");
  expect(context.reportModel).toBe("deepseek/deepseek-v4.1-flash");
});

test("missing Sites identity is rejected", async () => {
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENROUTER_API_KEY = "or-test";

  const request = requestWith({});

  await expect(getPrivateResearchContext(request)).rejects.toMatchObject({ status: 401 });
});

test("the wrong owner email is rejected", async () => {
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENROUTER_API_KEY = "or-test";

  const request = requestWith({
    "oai-authenticated-user-id": "user-123",
    "oai-authenticated-user-email": "someone-else@example.com",
  });

  await expect(getPrivateResearchContext(request)).rejects.toMatchObject({ status: 403 });
});

test("research uses OpenRouter web search with the trusted-source allowlist", async () => {
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.OPENROUTER_API_KEY = "or-test";
  env.AGENT_DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash";
  env.DB = {} as never;
  vi.spyOn(ResearchStore.prototype, "findReport").mockResolvedValue(null);
  vi.spyOn(ResearchStore.prototype, "reserve").mockResolvedValue("reserved");
  vi.spyOn(ResearchStore.prototype, "saveReport").mockResolvedValue();
  let fetched: { url: string; init?: RequestInit } | undefined;
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => { fetched = { url: String(url), init }; return Response.json({ output_text: JSON.stringify({ companyNews: "Official disclosure found.", risks: "Delayed price data.", verdict: "RESEARCH" }) }); });
  vi.stubGlobal("fetch", fetcher);

  await createOrReuseReport(
    await getPrivateResearchContext(requestWith({ ...ownerHeaders })),
    { code: "1303", name: "Electrical Industries", relativeStrengthPct: 3.2, squeeze: true, conditionsMet: 2 },
    { asOf: "2026-09-20T08:00:00Z", dataStatus: "delayed-daily" },
  );

  expect(fetched?.url).toBe("https://openrouter.ai/api/v1/responses");
  const body = JSON.parse(String(fetched?.init?.body));
  expect(body.model).toBe("deepseek/deepseek-v4.1-flash");
  expect(body.tools).toEqual([{ type: "openrouter:web_search", parameters: expect.objectContaining({ engine: "exa", allowed_domains: ["saudiexchange.sa", "cma.org.sa", "argaam.com", "reuters.com", "bloomberg.com"] }) }]);
});
