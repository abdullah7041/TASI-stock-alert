import assert from "node:assert/strict";
import test from "node:test";
import { foldPortfolio, proposeMonthlyAction } from "../app/lib/portfolio-core.mjs";

test("one monthly contribution and confirmed sale proceeds carry forward", () => {
  const events = [
    { operationId: "c-2026-08", kind: "contribution", month: "2026-08", cashSar: 500, confirmedAt: "2026-08-01T08:00:00Z" },
    { operationId: "b-1", kind: "buy", code: "1303", name: "EIC", shares: 10, priceSar: 12, feesSar: 0, confirmedAt: "2026-08-02T08:00:00Z" },
    { operationId: "s-1", kind: "sell", code: "1303", name: "EIC", shares: 4, priceSar: 13, feesSar: 0, confirmedAt: "2026-09-02T08:00:00Z" },
  ];
  const state = foldPortfolio(events);
  assert.equal(state.cashSar, 432);
  assert.deepEqual(state.holdings, [{ code: "1303", name: "EIC", shares: 6 }]);
  assert.throws(() => foldPortfolio([...events, events[0]]), /duplicate operation/i);
});

test("rejects overspending and overselling confirmed positions", () => {
  assert.throws(() => foldPortfolio([{ operationId: "buy", kind: "buy", code: "1303", name: "EIC", shares: 1, priceSar: 12, feesSar: 0, confirmedAt: "2026-08-02T08:00:00Z" }]), /cash/i);
  assert.throws(() => foldPortfolio([
    { operationId: "c", kind: "contribution", month: "2026-08", cashSar: 500, confirmedAt: "2026-08-01T08:00:00Z" },
    { operationId: "s", kind: "sell", code: "1303", name: "EIC", shares: 1, priceSar: 12, feesSar: 0, confirmedAt: "2026-08-02T08:00:00Z" },
  ]), /holding/i);
});

test("uses confirmed cash and can prefer adding to an owned Top 10 name", () => {
  const result = proposeMonthlyAction({
    cashSar: 620,
    holdings: [{ code: "1303", name: "EIC", shares: 10 }],
    approved: [
      { code: "1303", name: "EIC", totalScore: 88, priceSar: 12, stopDistancePct: 0.09, owned: true },
      { code: "1150", name: "Alinma", totalScore: 82, priceSar: 40, stopDistancePct: 0.10, owned: false },
    ], materialRisks: [], evidenceAsOf: "2026-08-12", priceAsOf: "2026-08-12T12:00:00Z",
  });
  assert.deepEqual(result, { action: "add", code: "1303", shares: 51, estimatedSpendSar: 612, cashAfterSar: 8, reason: "Best approved risk-adjusted score.", evidenceAsOf: "2026-08-12", priceAsOf: "2026-08-12T12:00:00Z", requiresConfirmation: true });
});

test("holds cash when no whole share clears the evidence gate", () => {
  assert.equal(proposeMonthlyAction({ cashSar: 500, holdings: [], approved: [], materialRisks: [], evidenceAsOf: "2026-08-12", priceAsOf: "2026-08-12T12:00:00Z" }).action, "hold_cash");
});
