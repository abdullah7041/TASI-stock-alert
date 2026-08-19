import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NAME_UNAVAILABLE, normalizeAlert, resolveAlertName, verifiedCompanyName } from "../app/lib/alert-names.mjs";
import { parseDashboardSnapshot } from "../app/lib/dashboard-core.mjs";

const storedAlert = {
  alertId: "a1",
  code: "4164",
  direction: "upside",
  observedAt: "2026-08-19T10:20:00Z",
  receivedAt: "2026-08-19T10:35:00Z",
  latency: "delayed-intraday",
  excessMovePct: 2.4,
  robustZ: 4.6,
  reason: "Delayed bot confirmation of statistically unusual price movement.",
};

test("keeps the name a named alert already carries", () => {
  assert.equal(resolveAlertName({ ...storedAlert, name: "Nahdi Medical" }), "Nahdi Medical");
});

test("resolves a legacy unnamed alert from the verified symbol catalog", () => {
  assert.equal(verifiedCompanyName("4164"), "Nahdi Medical");
  assert.equal(verifiedCompanyName("6017"), "Jahez");
  assert.equal(resolveAlertName(storedAlert), "Nahdi Medical");
});

test("says the name is unavailable rather than presenting the code as a name", () => {
  assert.equal(resolveAlertName({ ...storedAlert, code: "9999" }), NAME_UNAVAILABLE);
  assert.equal(resolveAlertName({ ...storedAlert, code: "9999", name: "   " }), NAME_UNAVAILABLE);
  assert.equal(NAME_UNAVAILABLE, "Company name unavailable");
  assert.notEqual(resolveAlertName({ ...storedAlert, code: "9999" }), "9999");
});

test("normalizes an alert without dropping its evidence fields", () => {
  const normalized = normalizeAlert({ ...storedAlert, volumeRatio: 2.5 });

  assert.equal(normalized.name, "Nahdi Medical");
  assert.equal(normalized.volumeRatio, 2.5);
  assert.equal(normalized.robustZ, 4.6);
  assert.equal(normalized.latency, "delayed-intraday");
});

test("an unverified catalog entry supplies no name", () => {
  const catalog = JSON.parse(readFileSync(new URL("../symbols.json", import.meta.url), "utf8"));
  const unverified = Object.entries(catalog).find(([, entry]) => entry.verified !== true);

  if (unverified) assert.equal(verifiedCompanyName(unverified[0]), null);
  assert.equal(verifiedCompanyName("0000"), null);
});

test("a stored version-2 snapshot without alert names still parses and gains names", () => {
  const snapshot = parseDashboardSnapshot({
    schemaVersion: 2,
    tradeDate: "2026-08-19",
    asOf: "2026-08-19T06:40:00Z",
    regime: "range",
    dataStatus: "delayed-daily",
    warnings: [],
    urgent: [],
    changed: [],
    qualified: [],
    researchCount: 0,
    monthlyBudgetSar: 500,
    summary: ["No holding crossed a decision level."],
    top10: { proposalId: "p1", status: "draft", researchedAt: "2026-08-19T06:00:00Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-19T06:00:00Z", cashSar: 0, contributionMonth: null, holdings: [], proposal: null },
    alerts: [storedAlert, { ...storedAlert, alertId: "a2", code: "9999" }],
    forecast: { status: "unavailable", asOf: "2026-08-19", reason: "validation gates not passed." },
  });

  assert.equal(snapshot.alerts[0].name, "Nahdi Medical");
  assert.equal(snapshot.alerts[1].name, NAME_UNAVAILABLE);
});

test("read paths hand the cockpit normalized name-bearing alerts", () => {
  const dashboard = readFileSync(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8");
  const alerts = readFileSync(new URL("../app/api/alerts/route.ts", import.meta.url), "utf8");

  assert.match(dashboard, /alerts: alerts\.map\(normalizeAlert\)/);
  assert.match(alerts, /\.map\(normalizeAlert\)/);
});

test("alert ingestion rejects a newly produced alert with no company name", () => {
  const source = readFileSync(new URL("../app/api/alerts/ingest/route.ts", import.meta.url), "utf8");

  assert.match(source, /Each alert must name its company\./);
  assert.match(source, /name: item\.name\.trim\(\)/);
});
