import assert from "node:assert/strict";
import test from "node:test";
import { parseMarketPulse } from "../app/lib/market-pulse-core.mjs";

const currentPulse = {
  schemaVersion: 1, artifactKind: "market-pulse", status: "current", source: "yahoo-probe",
  dataStatus: "delayed-intraday", intervalMinutes: 5, declaredDelayMinutes: 15,
  fetchedAt: "2026-09-22T07:20:00Z", observedAt: "2026-09-22T07:15:00Z",
  coverage: { tracked: 2, usable: 2, required: 1 },
  index: { code: "^TASI.SR", price: 11010, changePct: 0.1, latestBarAt: "2026-09-22T07:15:00Z" },
  regime: { status: "available", label: "ok", bars: 52 },
  observations: [{ code: "1303", price: 15.3, changePct: 2, latestBarAt: "2026-09-22T07:15:00Z" }],
};

test("accepts a timestamped current delayed market pulse", () => {
  assert.equal(parseMarketPulse(currentPulse).status, "current");
});

test("rejects a current market pulse with no completed index-bar timestamp", () => {
  const invalid = structuredClone(currentPulse);
  delete invalid.index.latestBarAt;
  assert.throws(() => parseMarketPulse(invalid), /latestBarAt/i);
});

test("accepts a stale pulse only when it identifies its last valid artifact", () => {
  const stale = { ...currentPulse, status: "stale", fetchedAt: "2026-09-22T07:25:00Z", lastValidAt: "2026-09-22T07:20:00Z", reason: "index fetch failed" };
  assert.equal(parseMarketPulse(stale).lastValidAt, "2026-09-22T07:20:00Z");
});
