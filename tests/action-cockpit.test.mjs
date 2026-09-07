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
  const workflow = readFileSync(new URL("../.github/workflows/tasi.yml", import.meta.url), "utf8")
    + readFileSync(new URL('../.github/cockpit-auth.sh', import.meta.url), 'utf8');

  assert.match(workflow, /COCKPIT_SIWC_BYPASS_TOKEN/);
  assert.match(workflow, /OAI-Sites-Authorization: Bearer/);
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

test("connects explicit approval and trade confirmation controls to their APIs", () => {
  const source = readFileSync(new URL("../app/components/ActionCockpit.tsx", import.meta.url), "utf8");

  const details = readFileSync(new URL('../app/components/CockpitDetails.tsx', import.meta.url), 'utf8');
  assert.match(source, /fetch\(['"]\/api\/top10\/approve['"]/);
  assert.match(details, /fetch\(['"]\/api\/portfolio\/events['"]/);
  assert.match(details, /Executed shares/);
  assert.match(details, /Execution price \(SAR\)/);
});

test("lint ignores local worktrees and their generated output", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  assert.match(packageJson.scripts.lint, /--ignore-pattern \.worktrees/);
  assert.match(packageJson.scripts.lint, /--ignore-pattern \.claude/);
});
