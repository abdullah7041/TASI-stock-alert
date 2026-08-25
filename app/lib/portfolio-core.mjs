function finitePositive(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive.`);
  return value;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function wholeShares(value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error("shares must be positive whole shares.");
  return value;
}

export function foldPortfolio(events) {
  const operations = new Set();
  const contributions = new Set();
  const holdings = new Map();
  let cashSar = 0;
  let confirmedAt = null;
  for (const event of events) {
    if (!event || typeof event !== "object" || typeof event.operationId !== "string" || !event.operationId) throw new Error("operationId is required.");
    if (operations.has(event.operationId)) throw new Error("duplicate operation.");
    operations.add(event.operationId);
    if (typeof event.confirmedAt !== "string" || !Number.isFinite(Date.parse(event.confirmedAt))) throw new Error("confirmedAt is required.");
    confirmedAt = !confirmedAt || event.confirmedAt > confirmedAt ? event.confirmedAt : confirmedAt;
    if (event.kind === "contribution") {
      if (!/^\d{4}-\d{2}$/.test(event.month ?? "")) throw new Error("contribution month is required.");
      if (contributions.has(event.month)) throw new Error("duplicate monthly contribution.");
      // Was pinned to exactly 500. That made a month where a different sum went
      // in unrecordable, which is not a rule -- it is the ledger refusing to
      // describe what happened. The monthly CAP still lives in config.BUDGET and
      // is enforced where budgets are decided, not here where facts are stored.
      const contributed = event.cashSar ?? 500;
      if (typeof contributed !== "number" || !Number.isFinite(contributed) || contributed <= 0) {
        throw new Error("contribution must be a positive amount.");
      }
      contributions.add(event.month);
      cashSar += contributed;
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
      ?? { code: event.code, name: event.name, shares: 0, avgCostSar: 0, realisedSar: 0 };
    if (event.kind === "buy") {
      const spend = shares * priceSar + feesSar;
      if (spend > cashSar + 1e-9) throw new Error("buy exceeds confirmed cash.");
      cashSar -= spend;
      // Weighted average cost, fees included because they are part of what the
      // position actually cost. Without this the ledger knew how many shares you
      // held and not what you paid, so profit and loss could not come from it --
      // which is why config.py carried a hand-maintained avg_cost, recomputed by
      // hand on every top-up.
      const priorCost = holding.avgCostSar * holding.shares;
      holding.shares += shares;
      holding.avgCostSar = round2((priorCost + spend) / holding.shares);
      holdings.set(event.code, holding);
    } else {
      if (shares > holding.shares) throw new Error("sell exceeds confirmed holding.");
      const proceeds = shares * priceSar - feesSar;
      // Average cost is unchanged by a sale: selling part of a position does not
      // alter what the remainder cost. The gain is booked separately so it stays
      // visible after the shares are gone.
      holding.realisedSar = round2(holding.realisedSar + proceeds - shares * holding.avgCostSar);
      holding.shares -= shares;
      cashSar += proceeds;
      if (holding.shares === 0) holdings.delete(event.code); else holdings.set(event.code, holding);
    }
  }
  return { cashSar: Math.round(cashSar * 100) / 100, holdings: [...holdings.values()].sort((a, b) => a.code.localeCompare(b.code)), contributionMonth: contributions.size ? [...contributions].sort().at(-1) : null, confirmedAt };
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
