import assert from "node:assert/strict";
import test from "node:test";
import { deliveryGuardSatisfied, deliveryGuardState } from "../scripts/delivery-guard.mjs";

const artifact = {
  schemaVersion: 3,
  artifactKind: "digest",
  artifactId: `sha256:${"a".repeat(64)}`,
  tradeDate: "2026-09-08",
};

test("production guard requires today's same-artifact Cockpit and Discord receipts", () => {
  assert.equal(deliveryGuardSatisfied({ snapshot: artifact, delivery: {
    cockpit: { status: "success" }, discord: { status: "success" },
  } }, "2026-09-08"), true);
  assert.equal(deliveryGuardSatisfied({ snapshot: artifact, delivery: {
    cockpit: { status: "success" }, discord: { status: "unknown" },
  } }, "2026-09-08"), false);
  assert.equal(deliveryGuardSatisfied({ snapshot: artifact, delivery: {
    cockpit: { status: "success" }, discord: { status: "success" },
  } }, "2026-09-07"), false);
});

test("production guard distinguishes an unavailable authority from no delivery", () => {
  assert.equal(deliveryGuardState(null, "2026-09-08"), "unknown");
  assert.equal(deliveryGuardState({ error: "Temporary gateway failure" }, "2026-09-08"), "unknown");
  assert.equal(deliveryGuardState({ snapshot: artifact, delivery: {
    cockpit: { status: "success" }, discord: { status: "unknown" },
  } }, "2026-09-08"), "not-delivered");
});
