import assert from "node:assert/strict";
import test from "node:test";
import { dashboardFreshness, parseDashboardSnapshot } from "../app/lib/dashboard-core.mjs";

const validSnapshot = {
  schemaVersion: 1,
  tradeDate: "2026-08-09",
  asOf: "2026-08-09T06:45:00Z",
  regime: "breakdown",
  dataStatus: "delayed-daily",
  warnings: [],
  urgent: [],
  changed: [],
  qualified: [{ code: "1150", name: "Alinma Bank", relativeStrengthPct: 10.4, squeeze: true, conditionsMet: 2 }],
  researchCount: 7,
  monthlyBudgetSar: 500,
};

test("accepts a valid saved dashboard snapshot", () => {
  const snapshot = parseDashboardSnapshot(validSnapshot);
  assert.equal(snapshot.qualified[0].code, "1150");
  assert.equal(snapshot.dataStatus, "delayed-daily");
});

test("rejects a dashboard snapshot that exposes a one-condition candidate", () => {
  assert.throws(() => parseDashboardSnapshot({ ...validSnapshot, qualified: [{ code: "4015", name: "Jamjoom", relativeStrengthPct: 7, squeeze: false, conditionsMet: 1 }] }), /two conditions/i);
});

test("keeps Thursday's snapshot current during the Riyadh weekend", () => {
  assert.equal(dashboardFreshness({ ...validSnapshot, tradeDate: "2026-08-13" }, new Date("2026-08-14T12:00:00Z")), "current");
});

test("marks a missing Sunday pre-open snapshot stale after the Riyadh deadline", () => {
  assert.equal(dashboardFreshness({ ...validSnapshot, tradeDate: "2026-08-13" }, new Date("2026-08-16T07:16:00Z")), "stale");
});
