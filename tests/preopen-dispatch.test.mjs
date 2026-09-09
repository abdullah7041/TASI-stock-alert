import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dispatchPreopenWorkflow, PREOPEN_CRON } from "../machine-gateway/preopen-dispatch.mjs";

test("Cloudflare pre-open cron dispatches the idempotent digest guard on main", async () => {
  let captured;
  await dispatchPreopenWorkflow("github-token", async (request) => {
    captured = request;
    return new Response(JSON.stringify({ workflow_run_id: 42 }), { status: 200 });
  });

  // Cloudflare uses 1=Sunday, unlike GitHub's 0=Sunday. Named days
  // prevent the invalid zero weekday that production rejected with 10100.
  assert.equal(PREOPEN_CRON, "20 5 * * SUN-THU");
  const config = JSON.parse(readFileSync(new URL("../wrangler.machine-gateway.json", import.meta.url), "utf8"));
  assert.deepEqual(config.triggers.crons, [PREOPEN_CRON]);
  assert.equal(captured.method, "POST");
  assert.equal(captured.url, "https://api.github.com/repos/abdullah7041/TASI-stock-alert/actions/workflows/tasi.yml/dispatches");
  assert.equal(captured.headers.get("authorization"), "Bearer github-token");
  assert.deepEqual(await captured.json(), { ref: "main", inputs: { mode: "digest-guard" } });
});

test("pre-open dispatch fails closed when its credential or GitHub response is invalid", async () => {
  await assert.rejects(() => dispatchPreopenWorkflow("", async () => new Response(null, { status: 200 })), /token/i);
  await assert.rejects(
    () => dispatchPreopenWorkflow("github-token", async () => new Response("denied", { status: 403 })),
    /403/,
  );
});
