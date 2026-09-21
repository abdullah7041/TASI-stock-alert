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

  expect(response.status).toBe(502);
  const body = await response.json() as { data: { content: string } };
  expect(body.data.content).toMatch(/Discord assistant is temporarily unavailable/i);
  expect(body.data.content).not.toMatch(/ledger rejected/i);
});
