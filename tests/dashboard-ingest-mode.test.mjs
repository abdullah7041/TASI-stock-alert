import assert from "node:assert/strict";
import test from "node:test";

import { dashboardIngestProjection } from "../app/lib/dashboard-ingest-mode.mjs";

const snapshot = {
  schemaVersion: 3,
  top10: { proposalId: "active" },
  top10Review: { proposalId: "review" },
  alerts: [{ alertId: "alert" }],
};

test("ordinary dashboard ingestion persists dashboard-derived collections", () => {
  assert.deepEqual(dashboardIngestProjection(snapshot, false), {
    top10Drafts: [snapshot.top10, snapshot.top10Review],
    alerts: snapshot.alerts,
  });
});

test("cockpit replay updates only the canonical dashboard and its receipt", () => {
  assert.deepEqual(dashboardIngestProjection(snapshot, true), {
    top10Drafts: [],
    alerts: [],
  });
});
