import assert from "node:assert/strict";
import test from "node:test";
import { dashboardReplayNeeded } from "../scripts/dashboard-replay.mjs";

const local = {
  schemaVersion: 3,
  tradeDate: "2026-09-07",
  artifactId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

test("replays when production is missing or behind even if the local file is unchanged", () => {
  assert.equal(dashboardReplayNeeded({ mode: "digest", local, remote: null }), true);
  assert.equal(dashboardReplayNeeded({
    mode: "digest",
    local,
    remote: { snapshot: { ...local, tradeDate: "2026-09-06", artifactId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
  }), true);
});

test("cockpit refresh always replays the canonical artifact without sending Discord", () => {
  assert.equal(dashboardReplayNeeded({ mode: "cockpit-refresh", local, remote: { snapshot: local } }), true);
});

test("ordinary modes skip an artifact already confirmed in production", () => {
  assert.equal(dashboardReplayNeeded({ mode: "reconcile", local, remote: {
    snapshot: local, delivery: { cockpit: { status: "success" } },
  } }), false);
});

test("an identical artifact is replayed when its Cockpit receipt is missing", () => {
  assert.equal(dashboardReplayNeeded({ mode: "reconcile", local, remote: {
    snapshot: local, delivery: { cockpit: { status: "unknown" } },
  } }), true);
});
