import assert from "node:assert/strict";
import test from "node:test";
import { parseDashboardSnapshot } from "../app/lib/dashboard-core.mjs";

test("accepts a valid saved dashboard snapshot", () => {
  const snapshot = parseDashboardSnapshot({ asOf: "2026-08-09T06:45:00Z", regime: "breakdown", urgent: [], changed: [], qualified: [{ code: "1150", name: "Alinma Bank", relativeStrengthPct: 10.4, squeeze: true, conditionsMet: 2 }], researchCount: 7 });
  assert.equal(snapshot.qualified[0].code, "1150");
});

test("rejects a dashboard snapshot that exposes a one-condition candidate", () => {
  assert.throws(() => parseDashboardSnapshot({ asOf: "2026-08-09T06:45:00Z", regime: "breakdown", urgent: [], changed: [], qualified: [{ code: "4015", name: "Jamjoom", relativeStrengthPct: 7, squeeze: false, conditionsMet: 1 }], researchCount: 0 }), /two conditions/i);
});
