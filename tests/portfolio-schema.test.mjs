import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { researchSchemaStatements } from "../db/schema.mjs";

function database() {
  const db = new DatabaseSync(":memory:");
  for (const statement of researchSchemaStatements) db.exec(statement);
  return db;
}

function insert(db, operationId, kind, values = {}, confirmedSecond = 0) {
  db.prepare(`INSERT INTO portfolio_events
    (operation_id, owner_id, event_kind, symbol, name, shares, price_sar, cash_sar, fees_sar, confirmed_at)
    VALUES (?, 'owner', ?, '1303', 'EIC', ?, ?, ?, 0, ?)`)
    .run(
      operationId,
      kind,
      values.shares ?? null,
      values.priceSar ?? null,
      values.cashSar ?? null,
      `2026-09-08T00:00:${String(confirmedSecond).padStart(2, "0")}Z`,
    );
}

test("serialized cash enforcement rejects a second otherwise-valid overspending buy", () => {
  const db = database();
  insert(db, "opening", "opening_balance", { cashSar: 100 });
  insert(db, "buy-a", "buy", { shares: 6, priceSar: 10 }, 1);
  assert.throws(
    () => insert(db, "buy-b", "buy", { shares: 6, priceSar: 10 }, 2),
    /confirmed cash/i,
  );
});

test("serialized share enforcement rejects a second otherwise-valid oversell", () => {
  const db = database();
  insert(db, "opening", "opening_balance", { cashSar: 0 });
  insert(db, "opening:1303", "opening_position", { shares: 10, priceSar: 12.41 });
  insert(db, "sell-a", "sell", { shares: 4, priceSar: 15 }, 1);
  assert.throws(
    () => insert(db, "sell-b", "sell", { shares: 7, priceSar: 15 }, 2),
    /confirmed holding/i,
  );
});
