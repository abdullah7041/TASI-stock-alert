function finitePositive(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive.`);
  return value;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function wholeShares(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("shares must be positive whole shares.");
  return value;
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("confirmedAt is required.");
  return new Date(value).toISOString();
}

export function expandPortfolioEvent(existing, event) {
  if (event?.kind === "opening_position") throw new Error("Opening positions are internal to the opening balance.");
  const normalizedEvent = { ...event, confirmedAt: canonicalTimestamp(event?.confirmedAt) };
  if (event?.kind !== "opening_balance") {
    const latest = existing.reduce((value, item) => Math.max(value, Date.parse(item.confirmedAt)), -Infinity);
    if (Number.isFinite(latest) && Date.parse(normalizedEvent.confirmedAt) <= latest) {
      throw new Error("confirmedAt must be later than the previous event.");
    }
    return [normalizedEvent];
  }
  if (existing.length) throw new Error("Opening balance requires an empty ledger.");
  if (typeof event.cashSar !== "number" || !Number.isFinite(event.cashSar) || event.cashSar < 0) {
    throw new Error("Opening cash must not be negative.");
  }
  if (!Array.isArray(event.holdings)) throw new Error("Opening holdings are required.");
  const codes = new Set();
  const positions = event.holdings.map((holding) => {
    if (!holding || typeof holding !== "object" || typeof holding.code !== "string" || !holding.code || typeof holding.name !== "string" || !holding.name) {
      throw new Error("Opening holding identity is required.");
    }
    if (codes.has(holding.code)) throw new Error("Duplicate holding in opening balance.");
    codes.add(holding.code);
    return {
      operationId: `${event.operationId}:position:${holding.code}`,
      kind: "opening_position",
      code: holding.code,
      name: holding.name,
      shares: wholeShares(holding.shares),
      ...(holding.avgCostSar == null ? {} : {priceSar: finitePositive(holding.avgCostSar, "avgCostSar")}),
      confirmedAt: normalizedEvent.confirmedAt,
    };
  });
  const expanded = [{
    operationId: event.operationId,
    kind: "opening_balance",
    cashSar: event.cashSar,
    reason: event.reason,
    confirmedAt: normalizedEvent.confirmedAt,
  }, ...positions];
  foldPortfolio(expanded);
  return expanded;
}

export function foldPortfolio(events) {
  const operations = new Set();
  const contributions = new Set();
  const holdings = new Map();
  // Realised P/L per code, kept apart from `holdings` so a fully sold position
  // does not take its own history with it when the holding is deleted.
  const realised = new Map();
  let cashSar = 0;
  let confirmedAt = null;
  let openingSeen = false;
  let regularEventSeen = false;
  for (const [index, event] of events.entries()) {
    if (!event || typeof event !== "object" || typeof event.operationId !== "string" || !event.operationId) throw new Error("operationId is required.");
    if (operations.has(event.operationId)) throw new Error("duplicate operation.");
    operations.add(event.operationId);
    const eventConfirmedAt = canonicalTimestamp(event.confirmedAt);
    confirmedAt = !confirmedAt || eventConfirmedAt > confirmedAt ? eventConfirmedAt : confirmedAt;
    if (event.kind === "opening_balance") {
      if (index !== 0 || openingSeen) throw new Error("Opening balance must be the first and only opening balance.");
      if (typeof event.cashSar !== "number" || !Number.isFinite(event.cashSar) || event.cashSar < 0) throw new Error("Opening cash must not be negative.");
      cashSar = event.cashSar;
      openingSeen = true;
      continue;
    }
    if (event.kind === "opening_position") {
      if (!openingSeen || regularEventSeen) throw new Error("Opening positions must immediately follow the opening balance.");
      if (typeof event.code !== "string" || !event.code || typeof event.name !== "string" || !event.name) throw new Error("symbol identity is required.");
      if (holdings.has(event.code)) throw new Error("Duplicate holding in opening balance.");
      holdings.set(event.code, {
        code: event.code,
        name: event.name,
        shares: wholeShares(event.shares),
        ...(event.priceSar == null ? {} : {avgCostSar: finitePositive(event.priceSar, "avgCostSar")}),
        realisedSar: 0,
      });
      continue;
    }
    regularEventSeen = true;
    if (event.kind === "contribution") {
      if (!/^\d{4}-\d{2}$/.test(event.month ?? "")) throw new Error("contribution month is required.");
      // Was pinned to exactly 500. That made a month where a different sum went
      // in unrecordable, which is not a rule -- it is the ledger refusing to
      // describe what happened. Legacy monthly caps live in config.BUDGET;
      // new broker accounts do not have a configured sizing policy.
      const contributed = event.cashSar;
      if (typeof contributed !== "number" || !Number.isFinite(contributed) || contributed <= 0) {
        throw new Error("contribution must be a positive amount.");
      }
      contributions.add(event.month);
      cashSar += contributed;
      continue;
    }
    if (["withdrawal", "dividend", "fee"].includes(event.kind)) {
      const amount = finitePositive(event.cashSar, "amount");
      const change = event.kind === "dividend" ? amount : -amount;
      if (cashSar + change < -1e-9) throw new Error("activity exceeds confirmed cash.");
      cashSar += change;
      continue;
    }
    if (event.kind === "cash_adjustment") {
      if (typeof event.reason !== "string" || !event.reason.trim()) throw new Error("cash adjustment reason is required.");
      if (typeof event.cashSar !== "number" || !Number.isFinite(event.cashSar)) throw new Error("cash adjustment is required.");
      if (cashSar + event.cashSar < -1e-9) throw new Error("cash adjustment exceeds confirmed cash.");
      cashSar += event.cashSar;
      continue;
    }
    if (!["buy", "sell"].includes(event.kind)) throw new Error("event kind is invalid.");
    if (typeof event.code !== "string" || !event.code || typeof event.name !== "string" || !event.name) throw new Error("symbol identity is required.");
    const shares = wholeShares(event.shares);
    const priceSar = finitePositive(event.priceSar, "priceSar");
    const feesSar = event.feesSar ?? 0;
    if (typeof feesSar !== "number" || !Number.isFinite(feesSar) || feesSar < 0) throw new Error("feesSar must not be negative.");
    const holding = holdings.get(event.code)
      ?? { code: event.code, name: event.name, shares: 0, avgCostSar: 0, realisedSar: realised.get(event.code) ?? 0 };
    if (event.kind === "buy") {
      const spend = shares * priceSar + feesSar;
      if (spend > cashSar + 1e-9) throw new Error("buy exceeds confirmed cash.");
      cashSar -= spend;
      // Weighted average cost, fees included because they are part of what the
      // position actually cost. Without this the ledger knew how many shares you
      // held and not what you paid, so profit and loss could not come from it --
      // which is why config.py carried a hand-maintained avg_cost, recomputed by
      // hand on every top-up.
      const priorCost = holding.avgCostSar == null ? null : holding.avgCostSar * holding.shares;
      holding.shares += shares;
      // Keep the full cost through later sales; rounding each share's cost
      // first invents a cent of realised gain on a SAR 100 / 3-share position.
      if (priorCost !== null) holding.avgCostSar = (priorCost + spend) / holding.shares;
      holdings.set(event.code, holding);
    } else {
      if (shares > holding.shares) throw new Error("sell exceeds confirmed holding.");
      const proceeds = shares * priceSar - feesSar;
      if (cashSar + proceeds < -1e-9) throw new Error("sale fees exceed confirmed cash and proceeds.");
      // Average cost is unchanged by a sale: selling part of a position does not
      // alter what the remainder cost. The gain is booked in `realised`, which
      // is keyed by code and OUTSIDE `holdings`, because a full exit deletes the
      // holding -- and booking it on the holding meant the realised gain was
      // dropped in exactly the case this comment claimed it survived.
      const priorRealised = realised.has(event.code) ? realised.get(event.code) : 0;
      realised.set(event.code, holding.avgCostSar == null || priorRealised === null ? null : round2(priorRealised + proceeds - shares * holding.avgCostSar));
      holding.realisedSar = realised.get(event.code);
      holding.shares -= shares;
      cashSar += proceeds;
      if (holding.shares === 0) holdings.delete(event.code); else holdings.set(event.code, holding);
    }
  }
  return { cashSar: Math.round(cashSar * 100) / 100, holdings: [...holdings.values()].sort((a, b) => a.code.localeCompare(b.code)), realisedSar: [...realised.values()].includes(null) ? null : round2([...realised.values()].reduce((total, value) => total + value, 0)), realisedByCode: Object.fromEntries([...realised.entries()].sort(([a], [b]) => a.localeCompare(b))), contributionMonth: contributions.size ? [...contributions].sort().at(-1) : null, confirmedAt };
}

export const brokerAccountIds = ['al_rajhi', 'al_ahli'];
const sizingPending = 'Sizing policy and fee assumptions are not configured.';
export class PortfolioConflict extends Error {}

function textValue(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}
function instant(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new Error('A timestamp with timezone is required.');
  return canonicalTimestamp(value);
}
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('Unexpected record field or account assignment.');
}
function normalizedEvent(payload) {
  fields(payload, ['kind','occurredAt','provenance','cashSar','holdings','code','name','shares','priceSar','feesSar','reason']);
  const {kind} = payload;
  if (!['opening_balance','contribution','buy','sell','withdrawal','dividend','fee'].includes(kind)) throw new Error('Invalid account event kind.');
  const occurredAt = instant(payload.occurredAt);
  fields(payload.provenance, ['source','reference']);
  if (payload.provenance.source !== 'manual') throw new Error('Manual provenance is required.');
  const provenance = {source:'manual', ...(payload.provenance.reference ? {reference:textValue(payload.provenance.reference,'reference')} : {})};
  const result = {kind,occurredAt,provenance};
  if (payload.reason != null) result.reason = textValue(payload.reason,'reason');
  if (['buy','sell'].includes(kind)) {
    if (!/^\d{4}$/.test(payload.code)) throw new Error('A four-digit stock code is required.');
    if (typeof payload.feesSar !== 'number' || !Number.isFinite(payload.feesSar) || payload.feesSar < 0) throw new Error('Actual feesSar is required, including zero.');
    Object.assign(result, {code:payload.code,name:textValue(payload.name,'name'),shares:wholeShares(payload.shares),priceSar:finitePositive(payload.priceSar,'priceSar'),feesSar:payload.feesSar});
  } else {
    if (kind === 'opening_balance' && payload.cashSar === 0) result.cashSar = 0;
    else result.cashSar = finitePositive(payload.cashSar,'amount');
    if (kind === 'opening_balance') {
      if (!Array.isArray(payload.holdings)) throw new Error('Opening holdings are required.');
      result.holdings = payload.holdings.map(h => {
        fields(h,['code','name','shares','avgCostSar']);
        if (!/^\d{4}$/.test(h.code)) throw new Error('A four-digit stock code is required.');
        return {code:h.code,name:textValue(h.name,'name'),shares:wholeShares(h.shares),...(h.avgCostSar == null ? {} : {avgCostSar:finitePositive(h.avgCostSar,'avgCostSar')})};
      });
    }
  }
  return result;
}

export function normalizeAccountRecordInput(input) {
  fields(input,['operationId','kind','payload']);
  const operationId = textValue(input.operationId,'operationId');
  if (operationId.length > 200) throw new Error('operationId is too long.');
  let payload;
  if (input.kind === 'event') payload = normalizedEvent(input.payload);
  else if (input.kind === 'correction') {
    fields(input.payload,['targetOperationId','replacement','reason']);
    payload = {targetOperationId:textValue(input.payload.targetOperationId,'targetOperationId'),replacement:input.payload.replacement === null ? null : normalizedEvent(input.payload.replacement),reason:textValue(input.payload.reason,'correction reason')};
  } else if (input.kind === 'reconciliation') {
    fields(input.payload,['statementAsOf','cashSar','holdings','reference']);
    const p = input.payload;
    if (typeof p.cashSar !== 'number' || !Number.isFinite(p.cashSar) || p.cashSar < 0 || !Array.isArray(p.holdings)) throw new Error('Statement cash and holdings are required.');
    const codes = new Set();
    const holdings = p.holdings.map(h => {
      fields(h,['code','shares']);
      if (!/^\d{4}$/.test(h.code) || codes.has(h.code) || !Number.isSafeInteger(h.shares) || h.shares < 0) throw new Error('Invalid or duplicate statement holding.');
      codes.add(h.code); return {code:h.code,shares:h.shares};
    });
    payload = {statementAsOf:instant(p.statementAsOf),cashSar:p.cashSar,holdings,reference:textValue(p.reference,'statement reference')};
  } else throw new Error('Invalid account record kind.');
  return {operationId,kind:input.kind,payload};
}

export function foldAccountRecords(records, accountId) {
  if (!brokerAccountIds.includes(accountId)) throw new Error('Invalid broker account.');
  const own = records.filter(r=>r.accountId === accountId).sort((a,b)=>a.revision-b.revision);
  const events = new Map(), operations = new Set();
  let lastReconciliation = null, correctedAfterStatement = false;
  own.forEach((r,index)=>{
    if (r.revision !== index + 1 || operations.has(r.operationId)) throw new Error('Invalid account revision or duplicate operation.');
    instant(r.recordedAt); operations.add(r.operationId);
    const input = normalizeAccountRecordInput({operationId:r.operationId,kind:r.kind,payload:r.payload});
    if (r.kind === 'event') events.set(r.operationId,{...input.payload,operationId:r.operationId,revision:r.revision});
    else if (r.kind === 'correction') {
      const target = events.get(input.payload.targetOperationId);
      if (!target) throw new Error('Correction target must be an original event in this account.');
      events.set(target.operationId,{...(input.payload.replacement ?? target),operationId:target.operationId,revision:target.revision,voided:input.payload.replacement === null});
      if (lastReconciliation) correctedAfterStatement = true;
    } else { lastReconciliation = input.payload; correctedAfterStatement = false; }
  });
  const effective = [...events.values()].filter(e=>!e.voided).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.revision-b.revision);
  if (effective.length && effective[0].kind !== 'opening_balance') throw new Error('A confirmed opening is required before account activity.');
  const project = list => {
    const expanded = list.flatMap(e=>{
      const item = {...e, confirmedAt:e.occurredAt};
      if (e.kind === 'opening_balance') return expandPortfolioEvent([],item);
      if (e.kind === 'contribution') item.month = new Date(Date.parse(e.occurredAt)+3*3600000).toISOString().slice(0,7);
      return [item];
    });
    return foldPortfolio(expanded);
  };
  const folded = project(effective);
  let discrepancies = [];
  if (lastReconciliation) {
    if (!effective.length || lastReconciliation.statementAsOf < effective[0].occurredAt) throw new Error('Statement precedes the opening history boundary.');
    const atStatement = project(effective.filter(e=>e.occurredAt <= lastReconciliation.statementAsOf));
    if (round2(lastReconciliation.cashSar-atStatement.cashSar) !== 0) discrepancies.push({field:'cash',ledger:atStatement.cashSar,statement:lastReconciliation.cashSar,difference:round2(lastReconciliation.cashSar-atStatement.cashSar)});
    const ledger = new Map(atStatement.holdings.map(h=>[h.code,h.shares])), statement = new Map(lastReconciliation.holdings.map(h=>[h.code,h.shares]));
    for (const code of [...new Set([...ledger.keys(),...statement.keys()])].sort()) {
      const a=ledger.get(code)??0, b=statement.get(code)??0;
      if (a!==b) discrepancies.push({field:'shares',code,ledger:a,statement:b,difference:b-a});
    }
  }
  const initialized = effective.length > 0;
  const reconciliationStatus = correctedAfterStatement ? 'needs_review' : lastReconciliation ? discrepancies.length ? 'discrepancy' : 'matched' : 'unreconciled';
  return {...folded,accountId,revision:own.length,initialized,cashSar:initialized?folded.cashSar:null,realisedSar:initialized?folded.realisedSar:null,confirmedAt:own.at(-1)?.recordedAt??null,
    lastReconciledAt:own.filter(r=>r.kind==='reconciliation').at(-1)?.recordedAt??null,reconciliationStatementAsOf:lastReconciliation?.statementAsOf??null,
    reconciliationStatus,discrepancies,historyComplete:initialized && !(effective[0].holdings?.length),quantityBlockers:[...(!initialized?['Opening account data is not confirmed.']:[]),...(reconciliationStatus!=='matched'?['Account reconciliation is unresolved.']:[]),sizingPending],proposal:null,records:own};
}

export function buildPortfolioBook(records, legacyEvents) {
  const accounts = brokerAccountIds.map(id=>{
    try { return foldAccountRecords(records,id); }
    catch { return {...foldAccountRecords([],id),error:'Account records could not be verified.',records:records.filter(r=>r.accountId===id)}; }
  });
  const complete = accounts.every(a=>a.initialized&&!a.error);
  return {schemaVersion:1,policyStatus:'unconfigured',accounts,combined:{cashSar:complete?round2(accounts.reduce((n,a)=>n+a.cashSar,0)):null,complete,spendable:false,confirmedAt:accounts.map(a=>({accountId:a.accountId,confirmedAt:a.confirmedAt}))},legacy:{status:'unassigned',events:legacyEvents}};
}

export function previewAccountRecord(records, accountId, input, expectedRevision) {
  const current = foldAccountRecords(records,accountId);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision) throw new PortfolioConflict('Account revision changed; refresh and preview again.');
  const record = normalizeAccountRecordInput(input);
  const projected = foldAccountRecords([...records,{...record,accountId,revision:current.revision+1,recordedAt:new Date().toISOString()}],accountId);
  return {record,expectedRevision,projected,differences:projected.discrepancies};
}

export function parseAccountEnvelope(value) {
  fields(value,['accountId','record','expectedRevision']);
  if (!brokerAccountIds.includes(value.accountId) || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) throw new Error('Broker account and expectedRevision are required.');
  return {accountId:value.accountId,record:normalizeAccountRecordInput(value.record),expectedRevision:value.expectedRevision};
}

export function parsePortfolioBook(value) {
  if (!value || value.schemaVersion !== 1 || value.policyStatus !== 'unconfigured' || !Array.isArray(value.accounts) || value.accounts.length !== 2 || value.legacy?.status !== 'unassigned' || !Array.isArray(value.legacy.events) || value.combined?.spendable !== false) throw new Error('Invalid portfolio account book.');
  const records = value.accounts.flatMap((a,i)=>{
    if (a.accountId !== brokerAccountIds[i] || !Array.isArray(a.records) || a.records.some(r=>r.accountId!==a.accountId)) throw new Error('Invalid broker account records.');
    return a.records;
  });
  const book = buildPortfolioBook(records,value.legacy.events);
  for (let i=0;i<2;i++) {
    if (['revision','initialized','cashSar','confirmedAt','reconciliationStatus'].some(k=>book.accounts[i][k] !== value.accounts[i][k])) throw new Error('Account projection does not match its records.');
  }
  return book;
}

export function proposeMonthlyAction({ cashSar, holdings, approved, materialRisks, evidenceAsOf, priceAsOf }) {
  const risk = materialRisks.find((item) => holdings.some((holding) => holding.code === item.code));
  if (risk) return { action: risk.sharesToSell ? "trim" : "sell", code: risk.code, shares: risk.sharesToSell, reason: risk.reason, evidenceAsOf, priceAsOf, requiresConfirmation: true };
  const eligible = approved.filter((item) => Number.isFinite(item.totalScore) && item.totalScore > 0 && Number.isFinite(item.priceSar) && item.priceSar > 0 && Number.isFinite(item.stopDistancePct) && item.stopDistancePct > 0);
  if (!eligible.length || cashSar <= 0) return { action: "hold_cash", reason: "No approved whole-share action clears the evidence gate.", evidenceAsOf, priceAsOf, requiresConfirmation: true };
  eligible.sort((a, b) => (b.totalScore / Math.max(b.stopDistancePct, 0.01)) - (a.totalScore / Math.max(a.stopDistancePct, 0.01)) || a.code.localeCompare(b.code));
  const chosen = eligible.find((item) => Math.floor(cashSar / item.priceSar) >= 1);
  if (!chosen) return { action: "hold_cash", reason: "Confirmed cash cannot buy one approved whole share.", evidenceAsOf, priceAsOf, requiresConfirmation: true };
  const shares = Math.floor(cashSar / chosen.priceSar);
  const estimatedSpendSar = Math.round(shares * chosen.priceSar * 100) / 100;
  return { action: chosen.owned ? "add" : "buy", code: chosen.code, shares, estimatedSpendSar, cashAfterSar: Math.round((cashSar - estimatedSpendSar) * 100) / 100, reason: "Best approved risk-adjusted score.", evidenceAsOf, priceAsOf, requiresConfirmation: true };
}
