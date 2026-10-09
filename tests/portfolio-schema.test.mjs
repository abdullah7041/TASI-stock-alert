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

test("account revisions serialize writes without changing legacy data or schema", () => {
  const db = database();
  insert(db, 'legacy', 'opening_balance', {cashSar:100});
  const before = db.prepare("SELECT sql FROM sqlite_master WHERE name LIKE 'portfolio_%' OR name LIKE 'one_%'").all();
  for (const sql of researchSchemaStatements) db.exec(sql);
  assert.deepEqual(db.prepare("SELECT sql FROM sqlite_master WHERE name LIKE 'portfolio_%' OR name LIKE 'one_%'").all(),before);
  const write = db.prepare(`INSERT INTO portfolio_account_records VALUES (?, 'owner', ?, ?, 'event', '2026-10-08T08:00:00Z', '{}')`);
  write.run('rajhi','al_rajhi',1);
  assert.throws(()=>write.run('stale','al_rajhi',1),/UNIQUE/i);
  write.run('ahli','al_ahli',1);
  assert.throws(()=>write.run('bad','other',1),/CHECK/i);
  assert.equal(db.prepare('SELECT cash_sar FROM portfolio_events').get().cash_sar,100);
});

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
