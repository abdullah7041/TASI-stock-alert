import assert from "node:assert/strict";
import test from "node:test";
import { dashboardFreshness, parseDashboardSnapshot } from "../app/lib/dashboard-core.mjs";
import { dashboardSnapshotKey, dashboardSnapshotReadKeys } from "../app/lib/dashboard-storage-core.mjs";

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

test("accepts separately dated market, research, portfolio, alert, and forecast evidence", () => {
  const snapshot = parseDashboardSnapshot({
    ...validSnapshot,
    schemaVersion: 2,
    summary: ["No confirmed trade requires action."],
    top10: { proposalId: "top10-2026-08-12", status: "draft", researchedAt: "2026-08-12T17:00:00Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-12T17:05:00Z", cashSar: 500, contributionMonth: "2026-08", holdings: [], proposal: null },
    alerts: [],
    forecast: { status: "unavailable", asOf: "2026-08-12", reason: "Validation gates not passed." },
  });
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.top10.researchedAt, "2026-08-12T17:00:00Z");
  assert.equal(snapshot.forecast.status, "unavailable");
});

test("preserves an optional canonical summary in a version-2 snapshot", () => {
  const snapshot = parseDashboardSnapshot({
    ...validSnapshot,
    schemaVersion: 2,
    summary: ["legacy line"],
    summaryV1: {
      version: 1,
      generatedAt: "2026-08-17T07:38:24Z",
      scheduledFor: "2026-08-17T06:45:00Z",
      latenessMinutes: 53,
      cards: [{ kind: "top10", state: "evidence-pending", text: "Top 10: evidence pending; no current primary-source review." }],
    },
    top10: { proposalId: "top10-2026-08-17", status: "draft", researchedAt: "2026-08-17T07:38:24Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-17T07:38:24Z", cashSar: 0, contributionMonth: null, holdings: [], proposal: null },
    alerts: [],
    forecast: { status: "unavailable", asOf: "2026-08-17", reason: "Validation gates not passed." },
  });
  assert.equal(snapshot.summaryV1.cards[0].kind, "top10");
  assert.equal(snapshot.summaryV1.latenessMinutes, 53);
});

test("keeps old version-2 snapshots readable without a canonical summary", () => {
  const snapshot = parseDashboardSnapshot({
    ...validSnapshot,
    schemaVersion: 2,
    summary: ["legacy line"],
    top10: { proposalId: "top10-2026-08-17", status: "draft", researchedAt: "2026-08-17T07:38:24Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-17T07:38:24Z", cashSar: 0, contributionMonth: null, holdings: [], proposal: null },
    alerts: [],
    forecast: { status: "unavailable", asOf: "2026-08-17", reason: "Validation gates not passed." },
  });
  assert.equal(snapshot.summaryV1, undefined);
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

test("keeps v1 rollback data separate while preferring the current v2 snapshot", () => {
  assert.equal(dashboardSnapshotKey(1), "latest");
  assert.equal(dashboardSnapshotKey(2), "latest-v2");
  assert.deepEqual(dashboardSnapshotReadKeys(), ["latest-v2", "latest"]);
});
