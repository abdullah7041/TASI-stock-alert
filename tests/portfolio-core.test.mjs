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
  // Selling 4 of 10 bought at 12 and sold at 13 leaves 6 shares still costing
  // 12 each -- a sale does not change what the remainder cost -- and books the
  // 4 SAR gain separately so it survives the shares being gone.
  assert.deepEqual(state.holdings, [
    { code: "1303", name: "EIC", shares: 6, avgCostSar: 12, realisedSar: 4 },
  ]);
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


test("adding to a position blends the cost you actually paid", () => {
  // This is the arithmetic that used to be done by hand in config.py on every
  // top-up: 104 shares at 12.41, then 20 more at 14.80 plus 5 SAR of fees.
  const state = foldPortfolio([
    { operationId: "c1", kind: "contribution", month: "2026-08", cashSar: 2000, confirmedAt: "2026-08-01T08:00:00Z" },
    { operationId: "b1", kind: "buy", code: "1303", name: "EIC", shares: 104, priceSar: 12.41, feesSar: 0, confirmedAt: "2026-08-02T08:00:00Z" },
    { operationId: "b2", kind: "buy", code: "1303", name: "EIC", shares: 20, priceSar: 14.8, feesSar: 5, confirmedAt: "2026-08-20T08:00:00Z" },
  ]);
  const [holding] = state.holdings;
  assert.equal(holding.shares, 124);
  // (104*12.41 + 20*14.80 + 5) / 124 = 1591.64 / 124 = 12.8358...
  assert.equal(holding.avgCostSar, 12.84);
});

test("a contribution may be any positive amount, not only 500", () => {
  // Pinning it to exactly 500 made a month where a different sum went in
  // unrecordable. The monthly cap belongs where budgets are decided, not in
  // the ledger that records what happened.
  const state = foldPortfolio([
    { operationId: "c1", kind: "contribution", month: "2026-08", cashSar: 320, confirmedAt: "2026-08-01T08:00:00Z" },
  ]);
  assert.equal(state.cashSar, 320);
  assert.throws(() => foldPortfolio([
    { operationId: "c2", kind: "contribution", month: "2026-08", cashSar: 0, confirmedAt: "2026-08-01T08:00:00Z" },
  ]), /positive/i);
});

test("the same trade recorded twice is rejected, not counted twice", () => {
  // Two front doors write this ledger -- the website form and the Discord
  // command -- so a double submit is a real scenario, and double-counting a
  // buy would silently corrupt both the position and the budget.
  const event = { operationId: "b1", kind: "buy", code: "1303", name: "EIC", shares: 1, priceSar: 12, feesSar: 0, confirmedAt: "2026-08-02T08:00:00Z" };
  const contribution = { operationId: "c1", kind: "contribution", month: "2026-08", cashSar: 500, confirmedAt: "2026-08-01T08:00:00Z" };
  assert.throws(() => foldPortfolio([contribution, event, event]), /duplicate operation/i);
});

test("realised profit survives selling the whole position", () => {
  // The gain was booked onto the holding and the holding was then deleted at
  // zero shares, so a full exit reported cash going up with no record of where
  // it came from -- in exactly the case the code's own comment said it was
  // preserved. Re-buying the code afterwards restarted realised at 0.
  const events = [
    { operationId: "c1", kind: "contribution", month: "2026-08", cashSar: 500, confirmedAt: "2026-08-01T08:00:00Z" },
    { operationId: "b1", kind: "buy", code: "1303", name: "EIC", shares: 10, priceSar: 12, feesSar: 0, confirmedAt: "2026-08-02T08:00:00Z" },
    { operationId: "s1", kind: "sell", code: "1303", name: "EIC", shares: 10, priceSar: 15, feesSar: 0, confirmedAt: "2026-08-20T08:00:00Z" },
  ];
  const exited = foldPortfolio(events);
  assert.deepEqual(exited.holdings, []);
  assert.equal(exited.realisedSar, 30);
  assert.deepEqual(exited.realisedByCode, { "1303": 30 });

  // And a later re-entry does not erase the earlier gain.
  const reentered = foldPortfolio([...events,
    { operationId: "b2", kind: "buy", code: "1303", name: "EIC", shares: 5, priceSar: 14, feesSar: 0, confirmedAt: "2026-08-25T08:00:00Z" },
  ]);
  assert.equal(reentered.realisedSar, 30);
  assert.deepEqual(reentered.holdings, [
    { code: "1303", name: "EIC", shares: 5, avgCostSar: 14, realisedSar: 30 },
  ]);
});
