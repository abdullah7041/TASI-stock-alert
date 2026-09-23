import assert from "node:assert/strict";
import test from "node:test";
import { parseObservationalPulse } from "../app/lib/observational-pulse-core.mjs";

const now = "2026-09-22T07:20:00Z";
const bar = "2026-09-22T07:15:00Z";
const observation = (code) => ({ code, price: 10, changePct: 0.2, latestBarAt: bar });
const current = {
  schemaVersion: 1, artifactKind: "market-pulse", status: "current", source: "yahoo-probe",
  dataStatus: "delayed-intraday", intervalMinutes: 5, declaredDelayMinutes: 15,
  fetchedAt: now, observedAt: bar, coverage: { tracked: 3, usable: 2, required: 2 },
  index: observation("^TASI.SR"), regime: { status: "unavailable", reason: "Daily index series unavailable." },
  observations: [observation("1303"), observation("2320")],
};

test("ingest validation rejects a claimed current pulse below seventy percent coverage", () => {
  assert.throws(() => parseObservationalPulse(current), /coverage/i);
  const valid = { ...current, coverage: { tracked: 3, usable: 3, required: 3 }, observations: [...current.observations, observation("4164")] };
  assert.equal(parseObservationalPulse(valid).status, "current");
});

test("ingest validation rejects open or too-old index bars", () => {
  const valid = { ...current, coverage: { tracked: 3, usable: 3, required: 3 }, observations: [...current.observations, observation("4164")] };
  assert.throws(() => parseObservationalPulse({ ...valid, index: { ...valid.index, latestBarAt: now }, observedAt: now }), /completed/i);
  assert.throws(() => parseObservationalPulse({ ...valid, index: { ...valid.index, latestBarAt: "2026-09-22T06:00:00Z" }, observedAt: "2026-09-22T06:00:00Z" }), /recent/i);
});
