import { afterEach, expect, test } from "vitest";
import { env } from "./cloudflare-workers-stub";

// `cloudflare:workers` is aliased to ./cloudflare-workers-stub.ts in
// vitest.config.ts. It must be an alias rather than a `vi.mock`: Vite resolves
// imports at transform time, before mock factories run, so a vi.mock here fails
// with "Failed to resolve import" and the suite never loads at all.
const { getPrivateResearchContext } = await import("@/app/lib/research-agent");

const ownerHeaders = {
  "oai-authenticated-user-id": "user-123",
  "oai-authenticated-user-email": "owner@example.com",
};

function requestWith(headers: Record<string, string>) {
  return new Request("https://example.com/api/portfolio", { headers });
}

afterEach(() => {
  for (const key of Object.keys(env)) delete env[key];
});

test("correct identity headers but no proxy secret header is rejected", async () => {
  env.OWNER_PROXY_SECRET = "correct-secret";
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENAI_API_KEY = "sk-test";

  const request = requestWith({ ...ownerHeaders });

  await expect(getPrivateResearchContext(request)).rejects.toMatchObject({ status: 401 });
});

test("a wrong proxy secret header is rejected", async () => {
  env.OWNER_PROXY_SECRET = "correct-secret";
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENAI_API_KEY = "sk-test";

  const request = requestWith({ ...ownerHeaders, "x-owner-proxy-secret": "wrong-secret" });

  await expect(getPrivateResearchContext(request)).rejects.toMatchObject({ status: 401 });
});

test("an unset OWNER_PROXY_SECRET is rejected regardless of identity headers", async () => {
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENAI_API_KEY = "sk-test";

  const request = requestWith({ ...ownerHeaders, "x-owner-proxy-secret": "anything" });

  await expect(getPrivateResearchContext(request)).rejects.toMatchObject({ status: 503 });
});

test("the correct secret and the owner's email resolves a context", async () => {
  env.OWNER_PROXY_SECRET = "correct-secret";
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENAI_API_KEY = "sk-test";

  const request = requestWith({ ...ownerHeaders, "x-owner-proxy-secret": "correct-secret" });

  const context = await getPrivateResearchContext(request);
  expect(context.ownerId).toBe("user-123");
});

test("the correct secret with the wrong owner email is still rejected", async () => {
  env.OWNER_PROXY_SECRET = "correct-secret";
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENAI_API_KEY = "sk-test";

  const request = requestWith({
    "oai-authenticated-user-id": "user-123",
    "oai-authenticated-user-email": "someone-else@example.com",
    "x-owner-proxy-secret": "correct-secret",
  });

  await expect(getPrivateResearchContext(request)).rejects.toMatchObject({ status: 403 });
});
