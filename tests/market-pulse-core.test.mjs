import assert from "node:assert/strict";
import test from "node:test";

import { parseMarketPulse } from "../app/lib/market-pulse-core.mjs";

const pulse = {
  schemaVersion: 1,
  artifactKind: "market-pulse",
  artifactId: `sha256:${"a".repeat(64)}`,
  asOf: "2026-09-16T07:10:00Z",
  dataStatus: "delayed-intraday",
  source: "yahoo",
  status: "available",
  requested: ["1303"],
  quotes: [{
    code: "1303", name: "EIC", price: 14.73, changePct: 1.3067,
    sessionVolume: 250, observedAt: "2026-09-16T07:05:00Z", latency: "delayed-intraday",
  }],
  errors: [],
};

test("accepts a canonical delayed market pulse", () => {
  assert.deepEqual(parseMarketPulse(pulse), pulse);
});

test("rejects a failed pulse that pretends to contain quotes", () => {
  assert.throws(
    () => parseMarketPulse({ ...pulse, status: "failed", quotes: pulse.quotes }),
    /failed market pulse cannot contain quotes/i,
  );
});

test("keeps valid empty and transport failure distinguishable", () => {
  const empty = parseMarketPulse({ ...pulse, status: "empty", quotes: [] });
  const failed = parseMarketPulse({ ...pulse, status: "failed", quotes: [], errors: ["Provider unavailable."] });
  assert.equal(empty.status, "empty");
  assert.equal(failed.status, "failed");
});
