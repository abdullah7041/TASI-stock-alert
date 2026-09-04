// The producer writes dashboard.json; the cockpit parses it. Nothing checked
// that those two agreed until the disagreement showed up in production as an
// HTTP 400 on every ingest, with the reason invisible because the workflow
// captured curl's error body into a variable that `set -e` aborted past.
//
// This is the cheap check that would have caught it: parse the committed
// artifact with the very function the site's ingest route calls. A producer
// change that the consumer cannot read now fails a build instead of a morning.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDashboardSnapshot } from "../app/lib/dashboard-core.mjs";

// Defaults to the committed artifact. CI regenerates one from the current
// producer code and points this at it, so the check covers what the producer
// writes TODAY rather than what it wrote when the last snapshot was committed.
const snapshotPath = process.env.DASHBOARD_SNAPSHOT_PATH
  ?? fileURLToPath(new URL("../dashboard.json", import.meta.url));

test("the committed dashboard artifact is readable by the site's own parser", () => {
  const raw = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const parsed = parseDashboardSnapshot(raw);
  assert.equal(parsed.tradeDate, raw.tradeDate);
  assert.ok(parsed.asOf, "a parsed snapshot must carry its observation time");
});

test("the producer's own artifact version is one the parser accepts", () => {
  const raw = JSON.parse(readFileSync(snapshotPath, "utf8"));
  assert.ok([1, 2, 3].includes(raw.schemaVersion),
    `dashboard.json is schemaVersion ${raw.schemaVersion}, which parseDashboardSnapshot rejects`);
});

test("extra producer keys do not break the parser", () => {
  // earlyMovers and indexUnavailable were added to the snapshot for the digest's
  // early-movers section. The parser drops keys it does not know rather than
  // rejecting them, and that tolerance is what lets the producer ship a field
  // ahead of the cockpit deploy that will read it. If that ever changes, adding
  // a field becomes a site outage, so it is pinned here deliberately.
  const raw = JSON.parse(readFileSync(snapshotPath, "utf8"));
  const withExtras = { ...raw, someFutureField: { nested: true } };
  assert.doesNotThrow(() => parseDashboardSnapshot(withExtras));
});
