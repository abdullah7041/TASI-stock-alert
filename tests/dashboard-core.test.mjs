import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dashboardFreshness, parseDashboardSnapshot } from "../app/lib/dashboard-core.mjs";
import { dashboardSnapshotKey, dashboardSnapshotReadKeys } from "../app/lib/dashboard-storage-core.mjs";
import {buildPortfolioBook} from '../app/lib/portfolio-core.mjs';

test('an unconfigured account artifact preserves unknown cash and rejects a broken new book',()=>{
  const raw=JSON.parse(readFileSync(new URL('../dashboard.json',import.meta.url),'utf8'));
  raw.monthlyBudgetSar=null;
  raw.portfolio={...raw.portfolio,cashSar:null,policyStatus:'unconfigured',accountBook:buildPortfolioBook([],[])};
  const parsed=parseDashboardSnapshot(raw);
  assert.equal(parsed.portfolio.policyStatus,'unconfigured');assert.equal(parsed.portfolio.cashSar,null);
  assert.equal(parsed.portfolio.accountBook.accounts[0].cashSar,null);
  raw.portfolio.accountBook.accounts[0].cashSar=999;
  assert.throws(()=>parseDashboardSnapshot(raw),/projection/i);
});

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

test("accepts a canonical v3 artifact with shared lean and chart content", () => {
  const snapshot = parseDashboardSnapshot({
    ...validSnapshot,
    schemaVersion: 3,
    artifactKind: "digest",
    artifactId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    scheduledFor: "2026-08-09T06:45:00Z",
    producer: { generatedAt: "2026-08-09T06:45:00Z" },
    digestRecords: [{ code: "1150", name: "Alinma Bank", price: 11.8, lean: { unavailable: "no GEMINI_API_KEY configured" } }],
    leanStatus: { ok: false, provider: "gemini", reason: "no GEMINI_API_KEY configured" },
    charts: [{
      code: "1150", name: "Alinma Bank", status: "available",
      bars: [
        { date: "2026-08-05", Open: 10, High: 11, Low: 9, Close: 10.5, Volume: 1000 },
        { date: "2026-08-06", Open: 10.5, High: 11.2, Low: 10, Close: 11, Volume: 1100 },
        { date: "2026-08-07", Open: 11, High: 11.5, Low: 10.8, Close: 11.2, Volume: 1200 },
        { date: "2026-08-08", Open: 11.2, High: 11.8, Low: 11, Close: 11.4, Volume: 1300 },
        { date: "2026-08-09", Open: 11.4, High: 12, Low: 11.2, Close: 11.8, Volume: 1400 },
      ], levels: { stop: 9.5, trim: 11.5, target: 12.5 },
    }],
    summary: ["legacy line"],
    top10: { proposalId: "top10-2026-08-09", status: "draft", researchedAt: "2026-08-09T06:45:00Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-09T06:45:00Z", cashSar: 0, contributionMonth: null, holdings: [], proposal: null },
    alerts: [],
    forecast: { status: "unavailable", asOf: "2026-08-09", reason: "Validation gates not passed." },
  });
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.artifactKind, "digest");
  assert.equal(snapshot.digestRecords[0].priceDate, "2026-08-09");
  assert.equal(snapshot.charts[0].bars.length, 5);
});

test("preserves safe diagnostics for an unavailable Gemini lean", () => {
  const parsed = parseDashboardSnapshot({
    ...validSnapshot,
    schemaVersion: 3,
    artifactKind: "digest",
    artifactId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    scheduledFor: "2026-08-09T06:45:00Z",
    producer: { generatedAt: "2026-08-09T06:45:00Z" },
    digestRecords: [{ code: "1150", name: "Alinma Bank", lean: { unavailable: "model call failed (ClientError)" } }],
    leanStatus: {
      ok: false,
      provider: "gemini",
      model: "gemini-2.5-flash",
      reason: "model call failed (ClientError)",
      errorType: "ClientError",
      httpStatus: 404,
      errorCategory: "not_found",
    },
    charts: [],
    summary: ["legacy line"],
    top10: { proposalId: "top10-2026-08-09", status: "draft", researchedAt: "2026-08-09T06:45:00Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-09T06:45:00Z", cashSar: 0, contributionMonth: null, holdings: [], proposal: null },
    alerts: [],
    forecast: { status: "unavailable", asOf: "2026-08-09", reason: "Validation gates not passed." },
  });

  assert.deepEqual(parsed.leanStatus, {
    ok: false,
    provider: "gemini",
    model: "gemini-2.5-flash",
    reason: "model call failed (ClientError)",
    errorType: "ClientError",
    httpStatus: 404,
    errorCategory: "not_found",
  });
});

test("rejects a v3 artifact without a SHA-256 identity", () => {
  assert.throws(() => parseDashboardSnapshot({ ...validSnapshot, schemaVersion: 3, artifactKind: "digest", artifactId: "not-an-id" }), /artifactId/i);
});

test("rejects a priced v3 decision record without its actual market date", () => {
  assert.throws(() => parseDashboardSnapshot({
    ...validSnapshot,
    schemaVersion: 3,
    artifactKind: "digest",
    artifactId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    scheduledFor: "2026-08-09T06:45:00Z",
    producer: { generatedAt: "2026-08-09T06:45:00Z" },
    digestRecords: [{ code: "1150", name: "Alinma Bank", price: 11.8, action: "WATCH", verified: true }],
    leanStatus: { ok: false, provider: "gemini", reason: "not run" },
    charts: [],
    summary: ["legacy line"],
    top10: { proposalId: "top10-2026-08-09", status: "draft", researchedAt: "2026-08-09T06:45:00Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-09T06:45:00Z", cashSar: 0, contributionMonth: null, holdings: [], proposal: null },
    alerts: [],
    forecast: { status: "unavailable", asOf: "2026-08-09", reason: "Validation gates not passed." },
  }), /priceDate/i);
});

test("rejects a price date that disagrees with the chart's final bar", () => {
  const malformed=JSON.parse(readFileSync(new URL("../dashboard.json",import.meta.url),"utf8"));
  const chart=malformed.charts.find((item)=>item.status==="available");
  const record=malformed.digestRecords.find((item)=>item.code===chart.code);
  record.priceDate="1999-01-01";
  assert.throws(()=>parseDashboardSnapshot(malformed),/priceDate.*chart/i);
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
  assert.deepEqual(dashboardSnapshotReadKeys(), ["latest-v3", "latest-v2", "latest"]);
});
