import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8");

test("a queued digest guard refreshes main and checks both production receipts", () => {
  assert.match(workflow, /Refresh canonical state for a queued guard[\s\S]*git checkout -B main origin\/main/);
  assert.match(workflow, /delivery-guard\.mjs \.guard-dashboard\.json/);
  assert.match(workflow, /TASI_PRODUCTION_DELIVERED: \$\{\{ steps\.delivery_guard\.outputs\.delivered \}\}/);
});

test("recovery can record Discord independently without resending it", () => {
  assert.match(workflow, /Record confirmed Discord delivery[\s\S]*cockpit-refresh,reconcile/);
  assert.match(workflow, /discord\.get\("status"\) != "success"/);
  assert.match(workflow, /--retry 5 --retry-all-errors --retry-max-time 90/);
});
