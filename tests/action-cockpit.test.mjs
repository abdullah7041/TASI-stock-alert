import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function renderDashboard() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders an action-first cockpit instead of a generic page", async () => {
  const response = await renderDashboard();
  const html = await response.text();

  assert.match(html, /TASI Action Cockpit/i);
  assert.match(html, /Loading the latest saved daily digest/i);
  assert.doesNotMatch(html, /Your site is taking shape/i);
});

test("does not import preview fixtures and includes an unavailable state", () => {
  const source = readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /fixtures\/dashboard/);
  assert.match(source, /No verified daily snapshot is available/i);
  assert.match(source, /Delayed\/daily data/i);
});

test("keeps dated evidence and the broker boundary visible for version-2 cockpit data", () => {
  // The alert surface moved into its own component, so the guarantees are now
  // spread across two files. tests/ui/action-cockpit.test.tsx checks the
  // rendered result; this keeps the wording itself from drifting silently.
  const source = readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8")
    + readFileSync(new URL("../app/components/AlertBoard.tsx", import.meta.url), "utf8");
  assert.match(source, /Today.*summary/i);
  assert.match(source, /Evidence reviewed/i);
  assert.match(source, /delayed bot confirmation/i);
  assert.match(source, /Broker app.*real-time/i);
  assert.match(source, /Forecast unavailable/i);
  assert.match(source, /Asia\/Riyadh/);
});

test("uses separate Sites and app credentials for private ingestion", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8");
  const authHelper = readFileSync(new URL('../.github/cockpit-auth.sh', import.meta.url), 'utf8');

  assert.match(workflow + authHelper, /COCKPIT_SIWC_BYPASS_TOKEN/);
  assert.match(authHelper, /OAI-Sites-Authorization: Bearer/);
  assert.match(authHelper, /Authorization: Bearer \$\{COCKPIT_INGEST_TOKEN:-\}/);
  assert.doesNotMatch(workflow, /Authorization: Bearer \$\{COCKPIT_INGEST_TOKEN/);
});

test("mirrors successful daily snapshots to the owner-facing Sites database without enabling pulse ingestion", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8");
  const start = workflow.indexOf("- name: Mirror daily dashboard to private Sites");
  assert.notEqual(start, -1, "daily dashboard mirror step must exist");
  const nextStep = workflow.indexOf("\n      - name:", start + 1);
  const step = workflow.slice(start, nextStep < 0 ? undefined : nextStep);

  assert.match(step, /steps\.run\.outcome == 'success'/);
  assert.match(step, /steps\.mode\.outputs\.mode/);
  assert.match(step, /vars\.SITES_DAILY_SYNC_ENABLED == 'true'/);
  assert.match(step, /continue-on-error:\s*true/);
  assert.match(step, /COCKPIT_SIWC_BYPASS_TOKEN/);
  assert.match(step, /COCKPIT_INGEST_TOKEN/);
  assert.match(step, /tasi-action-cockpit\.busaud7041\.chatgpt\.site\/api\/dashboard\/ingest/);
  assert.match(step, /--data-binary @dashboard\.json/);
  assert.doesNotMatch(step, /market-pulse|pulse\/ingest|DISCORD_WEBHOOK_URL/);
});

test("mirrors movement alerts to the owner-facing Sites database only for the movement mode", () => {
  const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8");
  const start = workflow.indexOf("- name: Mirror movement alerts to private Sites");
  assert.notEqual(start, -1, "movement alert mirror step must exist");
  const nextStep = workflow.indexOf("\n      - name:", start + 1);
  const step = workflow.slice(start, nextStep < 0 ? undefined : nextStep);

  assert.match(step, /steps\.mode\.outputs\.mode == 'run'/);
  assert.match(step, /vars\.SITES_DAILY_SYNC_ENABLED == 'true'/);
  assert.match(step, /continue-on-error:\s*true/);
  assert.match(step, /COCKPIT_SIWC_BYPASS_TOKEN/);
  assert.match(step, /COCKPIT_INGEST_TOKEN/);
  assert.match(step, /tasi-action-cockpit\.busaud7041\.chatgpt\.site\/api\/alerts\/ingest/);
  assert.match(step, /--data-binary @movement_alerts\.json/);
  assert.doesNotMatch(step, /DISCORD_WEBHOOK_URL|market-pulse|pulse\/ingest/);
});

test("ingestion stores a version-2 draft and alert history without approving it", () => {
  const source = readFileSync(new URL("../app/api/dashboard/ingest/route.ts", import.meta.url), "utf8");
  assert.match(source, /Top10Store/);
  assert.match(source, /saveDraft/);
  assert.match(source, /AlertStore/);
  assert.doesNotMatch(source, /\.decide\(/);
});

test("exposes release-safe health and separate alert ingestion endpoints", () => {
  const health = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8");
  const alertIngest = readFileSync(new URL("../app/api/alerts/ingest/route.ts", import.meta.url), "utf8");

  assert.match(health, /DEPLOYED_COMMIT_SHA/);
  assert.match(health, /acceptedSchemaVersions/);
  assert.doesNotMatch(health, /snapshot_json|portfolio_events/i);
  assert.match(alertIngest, /DASHBOARD_INGEST_TOKEN/);
  assert.match(alertIngest, /AlertStore/);
  assert.match(alertIngest, /appendMany/);
});

test("composes independently ingested alerts into the dashboard response", () => {
  const route = readFileSync(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8");
  const cockpit = readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8");

  assert.match(route, /AlertStore/);
  assert.match(route, /latest\(20\)/);
  assert.match(route, /freshness: dashboardFreshness\(snapshot\), alerts/);
  assert.match(cockpit, /alerts=\{data\.alerts\}/);
});

test("ingests the delayed market pulse separately and composes it into the cockpit", () => {
  const route = readFileSync(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8");
  const pulseIngest = readFileSync(new URL("../app/api/pulse/ingest/route.ts", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8");

  assert.match(route, /MarketPulseStore/);
  assert.match(route, /marketPulse/);
  assert.match(pulseIngest, /DASHBOARD_INGEST_TOKEN/);
  assert.match(pulseIngest, /parseMarketPulse/);
  assert.match(pulseIngest, /MarketPulseStore/);
  assert.match(workflow, /\/api\/pulse\/ingest/);
  assert.match(workflow, /--data-binary @market_pulse\.json/);
});

test("connects explicit research approval controls to their API", () => {
  const source = readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8");

  assert.match(source, /fetch\(['"]\/api\/top10\/approve['"]/);
  // Trade preview/confirmation is exercised through the rendered account form
  // in tests/ui/executed-trade.test.tsx, rather than a source-file substring.
});

test("registers Discord assistant commands and routes them through the copilot service", () => {
  const commands = readFileSync(new URL("../discord-interactions/src/commands.mjs", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/discord/interactions/route.ts", import.meta.url), "utf8");
  assert.match(commands, /name: "ask"/);
  assert.match(commands, /name: "decide"/);
  assert.match(route, /answerPortfolioQuestion/);
  assert.match(route, /No order was sent/);
});

test("lint ignores local worktrees and their generated output", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(packageJson.scripts.lint, /--ignore-pattern \.worktrees/);
  assert.match(packageJson.scripts.lint, /--ignore-pattern \.claude/);
});
