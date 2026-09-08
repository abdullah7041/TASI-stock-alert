import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { researchSchemaStatements } from "@/db/schema";

function database() {
  const db = new DatabaseSync(":memory:");
  for (const statement of researchSchemaStatements) db.exec(statement);
  return db;
}

function insert(
  db: DatabaseSync,
  operationId: string,
  kind: string,
  values: { shares?: number; priceSar?: number; cashSar?: number } = {},
  confirmedSecond = 0,
) {
  db.prepare(`INSERT INTO portfolio_events
    (operation_id, owner_id, event_kind, symbol, name, shares, price_sar, cash_sar, fees_sar, confirmed_at)
    VALUES (?, 'owner', ?, '1303', 'EIC', ?, ?, ?, 0, ?)`)
    .run(operationId, kind, values.shares ?? null, values.priceSar ?? null, values.cashSar ?? null, `2026-09-08T00:00:${String(confirmedSecond).padStart(2, "0")}Z`);
}

describe("portfolio database invariants", () => {
  it("serializes cash enforcement so a second otherwise-valid buy cannot overspend", () => {
    const db = database();
    insert(db, "opening", "opening_balance", { cashSar: 100 });
    insert(db, "buy-a", "buy", { shares: 6, priceSar: 10 }, 1);

    expect(() => insert(db, "buy-b", "buy", { shares: 6, priceSar: 10 }, 2))
      .toThrow(/confirmed cash/i);
  });

  it("serializes share enforcement so a second otherwise-valid sale cannot oversell", () => {
    const db = database();
    insert(db, "opening", "opening_balance", { cashSar: 0 });
    insert(db, "opening:1303", "opening_position", { shares: 10, priceSar: 12.41 });
    insert(db, "sell-a", "sell", { shares: 4, priceSar: 15 }, 1);

    expect(() => insert(db, "sell-b", "sell", { shares: 7, priceSar: 15 }, 2))
      .toThrow(/confirmed holding/i);
  });
});
