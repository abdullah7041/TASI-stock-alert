import assert from "node:assert/strict";
import test from "node:test";
import { assertApprovableTop10, nextTop10ReviewAt } from "../app/lib/top10-lifecycle.mjs";
import { readFileSync } from "node:fs";

test("Top 10 approval schedules the next review exactly three calendar months later", () => {
  assert.equal(nextTop10ReviewAt("2026-01-31T12:30:00Z"), "2026-04-30T12:30:00.000Z");
});

test("an empty Top 10 can be drafted but cannot be approved", () => {
  assert.throws(() => assertApprovableTop10({ entries: [] }), /at least one/i);
});

test("storage rejects legacy empty approvals before they block a real approval", () => {
  const source = readFileSync(new URL("../app/lib/top10-store.ts", import.meta.url), "utf8");
  assert.match(source, /json_array_length\(proposal_json, '\$\.entries'\)/);
  assert.match(source, /item\.entries\.length > 0/);
});
