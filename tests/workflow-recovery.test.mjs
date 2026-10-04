import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8").replaceAll('\r\n', '\n');

test("session pulse ingestion requires explicit opt-in and reports disabled ingestion", () => {
  // Removing this guard would resume unauthorized POSTs and the recurring 404.
  const step = workflow.split('      - name: Update delayed market pulse\n')[1]?.split('\n      - name:')[0];
  assert.match(step ?? '', /if:.*vars\.TASI_PULSE_INGESTION_ENABLED == 'true'/);
  assert.match(workflow, /name: Report disabled market pulse ingestion[\s\S]*vars\.TASI_PULSE_INGESTION_ENABLED != 'true'[\s\S]*pulse_ingestion=disabled/);
});

test("a queued digest guard refreshes main and checks both production receipts", () => {
  assert.match(workflow, /Refresh canonical state for a queued guard[\s\S]*git checkout -B main origin\/main/);
  assert.match(workflow, /delivery-guard\.mjs \.guard-dashboard\.json/);
  assert.match(workflow, /TASI_PRODUCTION_DELIVERED: \$\{\{ steps\.delivery_guard\.outputs\.delivered \}\}/);
});

test("an unavailable production authority aborts the delivery guard", () => {
  assert.match(workflow, /GUARD_STATE.*delivery-guard\.mjs/);
  assert.match(workflow, /GUARD_STATE.*unknown[\s\S]*exit 1/);
});

test("cockpit refresh labels ingestion as dashboard-only replay", () => {
  assert.match(workflow, /x-tasi-replay-only/);
});

test("every workflow mode that reads holdings requires the confirmed ledger", () => {
  assert.match(workflow, /contains\('run,digest,digest-guard,suggest,autolevels,top10-draft,intraday-probe'/);
  assert.match(workflow, /TASI_REQUIRE_PORTFOLIO_LEDGER:.*contains\('run,digest,digest-guard,suggest,autolevels,top10-draft,intraday-probe'/);
  assert.match(workflow, /eventCount[\s\S]*opening balance/i);
  assert.match(workflow, /isinstance\(payload\.get\("eventCount"\), bool\)/);
});

test("recovery can record Discord independently without resending it", () => {
  assert.match(workflow, /Record confirmed Discord delivery[\s\S]*cockpit-refresh,reconcile/);
  assert.match(workflow, /discord\.get\("status"\) != "success"/);
  assert.match(workflow, /--retry 5 --retry-all-errors --retry-max-time 90/);
});
