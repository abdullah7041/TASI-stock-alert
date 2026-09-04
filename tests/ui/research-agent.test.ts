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

test("Sites-authenticated owner identity resolves a private context", async () => {
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENAI_API_KEY = "sk-test";

  const request = requestWith({ ...ownerHeaders });

  const context = await getPrivateResearchContext(request);
  expect(context.ownerId).toBe("user-123");
});

test("missing Sites identity is rejected", async () => {
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENAI_API_KEY = "sk-test";

  const request = requestWith({});

  await expect(getPrivateResearchContext(request)).rejects.toMatchObject({ status: 401 });
});

test("the wrong owner email is rejected", async () => {
  env.AGENT_OWNER_EMAIL = "owner@example.com";
  env.DB = {} as never;
  env.OPENAI_API_KEY = "sk-test";

  const request = requestWith({
    "oai-authenticated-user-id": "user-123",
    "oai-authenticated-user-email": "someone-else@example.com",
  });

  await expect(getPrivateResearchContext(request)).rejects.toMatchObject({ status: 403 });
});
