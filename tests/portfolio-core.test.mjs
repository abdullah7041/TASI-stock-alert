import assert from "node:assert/strict";
import test from "node:test";
import { expandPortfolioEvent, foldPortfolio, proposeMonthlyAction } from "../app/lib/portfolio-core.mjs";
import * as accounts from "../app/lib/portfolio-core.mjs";

const eventRecord = (id, payload, revision = 1, accountId = 'al_rajhi') => ({
  operationId: id, accountId, revision, recordedAt: `2026-10-08T08:00:${String(revision).padStart(2,'0')}Z`,
  kind: 'event', payload: { occurredAt: `2026-10-01T08:00:${String(revision).padStart(2,'0')}Z`, provenance: {source:'manual'}, ...payload },
});
const openAccount = (cashSar = 300, holdings = [], accountId = 'al_rajhi') => eventRecord(`open-${accountId}`, {kind:'opening_balance', cashSar, holdings}, 1, accountId);
const foldAccount = (records) => accounts.foldAccountRecords(records, 'al_rajhi');

test('uninitialized accounts never invent confirmed cash or a spendable combined balance', () => {
  const book = accounts.buildPortfolioBook([], []);
  assert.deepEqual(book.accounts.map(a=>a.accountId), ['al_rajhi','al_ahli']);
  assert.equal(book.accounts[0].cashSar,null);
  assert.equal(book.accounts[0].initialized,false);
  assert.equal(book.combined.cashSar,null);
  assert.equal(book.combined.spendable,false);
});

test('broker balances and identical stocks stay independent while legacy records remain unassigned', () => {
  const legacy = [{operationId:'old'}];
  const book = accounts.buildPortfolioBook([
    openAccount(300,[{code:'2320',name:'Al-Babtain',shares:2}]),
    openAccount(400,[{code:'2320',name:'Al-Babtain',shares:3,avgCostSar:40}],'al_ahli'),
  ],legacy);
  assert.deepEqual(book.accounts.map(a=>a.cashSar),[300,400]);
  assert.deepEqual(book.accounts.map(a=>a.holdings[0].shares),[2,3]);
  assert.equal(book.accounts[0].holdings[0].avgCostSar,undefined);
  assert.equal(book.accounts[0].historyComplete,false);
  assert.equal(book.combined.cashSar,700);
  assert.deepEqual(book.legacy.events,legacy);
  assert.equal(book.accounts[0].proposal,null);
});

test('multiple contributions in one month require actual amounts and carry forward', () => {
  const records=[openAccount(0),eventRecord('d1',{kind:'contribution',cashSar:125},2),eventRecord('d2',{kind:'contribution',cashSar:40},3)];
  assert.equal(foldAccount(records).cashSar,165);
  assert.throws(()=>foldAccount([...records,eventRecord('missing',{kind:'contribution'},4)]),/amount|positive|contribution/i);
  assert.throws(()=>foldAccount([eventRecord('no-opening',{kind:'contribution',cashSar:10})]),/opening/i);
});

test('cash flows and fees are counted once and cannot overspend the selected account', () => {
  const records=[openAccount(100),eventRecord('buy',{kind:'buy',code:'2320',name:'Al-Babtain',shares:2,priceSar:25,feesSar:2},2),
    eventRecord('div',{kind:'dividend',cashSar:8},3),eventRecord('fee',{kind:'fee',cashSar:1},4),eventRecord('withdraw',{kind:'withdrawal',cashSar:10},5)];
  assert.equal(foldAccount(records).cashSar,45);
  assert.throws(()=>foldAccount([...records,eventRecord('too-much',{kind:'withdrawal',cashSar:46},6)]),/cash/i);
  assert.throws(()=>foldAccount([...records,eventRecord('missing-fees',{kind:'buy',code:'2320',name:'Al-Babtain',shares:1,priceSar:1},6)]),/fees/i);
});

test('known realised gains survive a full sale while unknown opening cost never becomes zero', () => {
  const sale={kind:'sell',code:'2320',name:'Al-Babtain',shares:2,priceSar:30,feesSar:1};
  const known=foldAccount([openAccount(0,[{code:'2320',name:'Al-Babtain',shares:2,avgCostSar:20}]),eventRecord('sale',sale,2)]);
  assert.equal(known.cashSar,59);assert.equal(known.realisedSar,19);assert.deepEqual(known.holdings,[]);
  const unknown=foldAccount([openAccount(0,[{code:'2320',name:'Al-Babtain',shares:2}]),eventRecord('sale',sale,2)]);
  assert.equal(unknown.realisedSar,null);
  assert.throws(()=>foldAccount([openAccount(0),eventRecord('sale',sale,2)]),/holding/i);
});

test('historical corrections replay every later event and preserve original records', () => {
  const records=[openAccount(100),eventRecord('buy',{kind:'buy',code:'2320',name:'Al-Babtain',shares:2,priceSar:30,feesSar:0},2)];
  const correction={operationId:'fix',accountId:'al_rajhi',revision:3,recordedAt:'2026-10-08T09:00:00Z',kind:'correction',payload:{targetOperationId:'open-al_rajhi',replacement:{...records[0].payload,cashSar:80},reason:'Statement correction'}};
  assert.equal(foldAccount([...records,correction]).cashSar,20);
  assert.equal(records[0].payload.cashSar,100);
  assert.throws(()=>foldAccount([...records,{...correction,payload:{...correction.payload,replacement:null}}]),/opening|cash/i);
  assert.throws(()=>foldAccount([...records,{...correction,payload:{...correction.payload,replacement:{...records[0].payload,cashSar:50}}}]),/cash/i);
  assert.throws(()=>foldAccount([...records,{...correction,payload:{...correction.payload,targetOperationId:'other-account'}}]),/target|account/i);
});

test('statement comparisons never change cash and corrections require reconciliation again', () => {
  const reconcile={operationId:'statement',accountId:'al_rajhi',revision:2,recordedAt:'2026-10-08T09:00:00Z',kind:'reconciliation',payload:{statementAsOf:'2026-10-02T08:00:00Z',cashSar:299,holdings:[],reference:'October statement'}};
  const state=foldAccount([openAccount(),reconcile]);
  assert.equal(state.cashSar,300);assert.equal(state.reconciliationStatus,'discrepancy');
  assert.deepEqual(state.discrepancies,[{field:'cash',ledger:300,statement:299,difference:-1}]);
  const matched={...reconcile,payload:{...reconcile.payload,cashSar:300}};
  assert.equal(foldAccount([openAccount(),matched]).reconciliationStatus,'matched');
  const fixed={operationId:'fix',accountId:'al_rajhi',revision:3,recordedAt:'2026-10-08T10:00:00Z',kind:'correction',payload:{targetOperationId:'open-al_rajhi',replacement:{...openAccount().payload,cashSar:299},reason:'Correction'}};
  assert.equal(foldAccount([openAccount(),matched,fixed]).reconciliationStatus,'needs_review');
  const later=eventRecord('later',{kind:'contribution',cashSar:20,occurredAt:'2026-10-03T08:00:00Z'},3);
  assert.equal(foldAccount([openAccount(),matched,later]).reconciliationStatus,'matched');
});

test('preview is read-only and rejects stale revisions and invalid record input', () => {
  const records=[openAccount()];
  const input={operationId:'deposit',kind:'event',payload:{kind:'contribution',cashSar:40,occurredAt:'2026-10-02T08:00:00Z',provenance:{source:'manual'}}};
  assert.equal(accounts.previewAccountRecord(records,'al_rajhi',input,1).projected.cashSar,340);
  assert.equal(records.length,1);
  assert.throws(()=>accounts.previewAccountRecord(records,'al_rajhi',input,0),/revision|refresh/i);
  assert.throws(()=>accounts.previewAccountRecord(records,'unknown',input,1),/account/i);
  assert.throws(()=>accounts.previewAccountRecord(records,'al_rajhi',{...input,payload:{...input.payload,occurredAt:'2026-09-01T08:00:00Z'}},1),/opening|before/i);
  assert.throws(()=>accounts.previewAccountRecord(records,'al_rajhi',{...input,payload:{...input.payload,accountId:'al_ahli'}},1),/account|field/i);
});

test("imports an opening balance without inventing cash contributions or buys", () => {
  const opening = {
    operationId: "opening-config-2026-09-07",
    kind: "opening_balance",
    confirmedAt: "2026-09-07T00:00:00Z",
    cashSar: 0,
    reason: "Confirmed migration from config",
    holdings: [
      { code: "1303", name: "EIC", shares: 104, avgCostSar: 12.41 },
      { code: "2320", name: "Al-Babtain", shares: 12, avgCostSar: 64.26 },
      { code: "8313", name: "Rasan", shares: 11, avgCostSar: 107.45 },
    ],
  };

  const persisted = expandPortfolioEvent([], opening);
  const state = foldPortfolio(persisted);

  assert.equal(state.cashSar, 0);
  assert.equal(state.contributionMonth, null);
  assert.deepEqual(state.holdings, [
    { code: "1303", name: "EIC", shares: 104, avgCostSar: 12.41, realisedSar: 0 },
    { code: "2320", name: "Al-Babtain", shares: 12, avgCostSar: 64.26, realisedSar: 0 },
    { code: "8313", name: "Rasan", shares: 11, avgCostSar: 107.45, realisedSar: 0 },
  ]);
  assert.deepEqual(persisted.map((event) => event.kind), ["opening_balance", "opening_position", "opening_position", "opening_position"]);
});

test("opening balance is first-event-only, unique, and validates every position", () => {
  const valid = {
    operationId: "opening-config-2026-09-07",
    kind: "opening_balance",
    confirmedAt: "2026-09-07T00:00:00Z",
    cashSar: 0,
    holdings: [{ code: "1303", name: "EIC", shares: 104, avgCostSar: 12.41 }],
  };
  const contribution = { operationId: "c1", kind: "contribution", month: "2026-09", cashSar: 500, confirmedAt: "2026-09-01T00:00:00Z" };

  assert.throws(() => expandPortfolioEvent([contribution], valid), /empty ledger/i);
  assert.throws(() => expandPortfolioEvent([], { ...valid, holdings: [...valid.holdings, valid.holdings[0]] }), /duplicate holding/i);
  assert.throws(() => expandPortfolioEvent([], { ...valid, holdings: [{ ...valid.holdings[0], shares: 0 }] }), /shares/i);
  assert.throws(() => expandPortfolioEvent([], {
    operationId: "forged-position", kind: "opening_position", code: "1303", name: "EIC",
    shares: 104, priceSar: 12.41, confirmedAt: "2026-09-07T00:00:00Z",
  }), /internal/i);
  assert.throws(() => foldPortfolio([...expandPortfolioEvent([], valid), { ...valid, operationId: "opening-second" }]), /opening balance/i);
});

test("later ledger events cannot be backdated before the persisted sequence", () => {
  const opening = {
    operationId: "opening-config-2026-09-07", kind: "opening_balance",
    confirmedAt: "2026-09-07T00:00:00Z", cashSar: 0,
    holdings: [{ code: "1303", name: "EIC", shares: 104, avgCostSar: 12.41 }],
  };
  const persisted = expandPortfolioEvent([], opening);
  assert.throws(() => expandPortfolioEvent(persisted, {
    operationId: "backdated-buy", kind: "buy", code: "1303", name: "EIC",
    shares: 1, priceSar: 10, confirmedAt: "2026-09-06T23:59:59Z",
  }), /later than the previous event/i);
});

test("event ordering compares normalized instants rather than timestamp strings", () => {
  const existing = [{ operationId: "open", kind: "opening_balance", cashSar: 100,
    confirmedAt: "2026-09-08T03:00:00+03:00" }];
  const later = expandPortfolioEvent(existing, { operationId: "later", kind: "contribution",
    month: "2026-09", cashSar: 50, confirmedAt: "2026-09-08T00:30:00Z" });
  assert.equal(later[0].confirmedAt, "2026-09-08T00:30:00.000Z");

  assert.throws(() => expandPortfolioEvent(
    [{ ...existing[0], confirmedAt: "2026-09-08T00:30:00Z" }],
    { operationId: "earlier", kind: "contribution", month: "2026-09", cashSar: 50,
      confirmedAt: "2026-09-08T03:00:00+03:00" },
  ), /later than the previous event/i);
});

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
