const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const reasons = (value) => Array.isArray(value) ? value.filter((s) => typeof s === 'string').join('. ') : typeof value === 'string' ? value : '';

function previousTradingDate(date) {
  const cursor=new Date(`${date}T00:00:00Z`);
  do cursor.setUTCDate(cursor.getUTCDate()-1); while (![0,1,2,3,4].includes(cursor.getUTCDay()));
  return cursor.toISOString().slice(0,10);
}

export function conditionReason(rule) {
  if (rule.rule === 'rsi_band') return Number(rule.actual) > 60
    ? 'Overbought: waiting for RSI to return to the recovery band.'
    : 'Oversold: waiting for RSI to return to the recovery band.';
  if (rule.rule === 'trend') return 'Waiting for an upward trend.';
  if (rule.rule === 'momentum_floor') return 'Six-month momentum is below your minimum.';
  return rule.plain || 'A required condition has not been met.';
}

/** A deterministic view of the producer artifact; never another model judgement. */
export function buildDecisionView(snapshot, freshness) {
  const records = snapshot.digestRecords ?? [];
  const charts = snapshot.charts ?? [];
  const holdings = snapshot.portfolio?.holdings ?? records.filter((r) => r.kind === 'holding');
  function stock(identity, owned = false) {
    const record = records.find((r) => r.code === identity.code) ?? {};
    const chart = charts.find((c) => c.code === identity.code);
    const bars = chart?.status === 'available' ? chart.bars : [];
    const latest = bars.at(-1);
    const price = finite(record.price);
    const action = String(record.action ?? '').toUpperCase();
    const known = ['HOLD','WATCH','BUY','SELL','SELL (STOP)','SELL (TARGET)','STOP','STOP_LOSS','EXIT','TRIM','TAKE_PROFIT','TARGET'].includes(action);
    const decisionChecksReady = !owned || (Array.isArray(record.rules) && record.rules.length > 0
      && record.rules.every((rule) => rule?.available !== false));
    const priceDate=record.priceDate ?? latest?.date ?? null;
    const quoteStale=owned && Boolean(priceDate) && priceDate < previousTradingDate(snapshot.tradeDate);
    const unavailable = price === null || price <= 0 || record.verified === false || freshness === 'stale' || !known || !decisionChecksReady || quoteStale;
    const stop = ['SELL','SELL (STOP)','STOP','STOP_LOSS','EXIT'].includes(action);
    const profit = ['SELL (TARGET)','TRIM','TAKE_PROFIT','TARGET'].includes(action);
    const label = unavailable ? 'Insufficient data' : stop ? 'Review stop' : profit ? 'Review profit level' : owned ? 'Hold' : 'Watching';
    const missing = (record.rules ?? []).filter((r) => !r.passed).map(conditionReason);
    const reason = freshness === 'stale' ? 'This is the last successful snapshot. Check current prices before reviewing a decision.'
      : quoteStale ? `This quote (${priceDate}) is older than the expected previous session. Check your broker before reviewing a decision.`
      : unavailable ? 'A verified price or complete rule check is unavailable.'
      : record.decision?.reason ? record.decision.reason
      : stop ? 'Your protective level was reached in the daily snapshot. Check your broker.'
      : profit ? 'Your profit-taking level was reached in the daily snapshot. Review it in your broker.'
      : owned ? 'No decision level crossed in this daily snapshot.'
      : missing.join(' ') || reasons(record.reason) || 'Research candidate; confirm the full entry conditions before acting.';
    return { code:identity.code, name:identity.name, owned, label, reason, price: price !== null && price > 0 ? price : null,
      priceDate,
      dailyChange:finite(record.delta?.price_pct), pnl:finite(record.unrealized_pct),
      conditionsMet:finite(record.rules_met), conditionsTotal:finite(record.rules_total),
      missing, chart, record, shares:identity.shares ?? null,
      needsAttention: !unavailable && (stop || profit), unavailable,
    };
  }
  const holdingViews = holdings.map((h) => stock(h, true)).sort((a,b) => Number(b.needsAttention)-Number(a.needsAttention));
  const holdingCodes = new Set(holdings.map((h) => h.code));
  const watchlist = records.filter((r) => r.kind === 'watchlist' && !holdingCodes.has(r.code)).map((r) => stock(r));
  const dates = [...new Set(holdingViews.map((h) => h.priceDate).filter(Boolean))].sort();
  return { holdings:holdingViews, watchlist, candidates:snapshot.qualified ?? [],
    attention:holdingViews.filter((h) => h.needsAttention).length,
    incomplete:freshness === 'stale' || holdingViews.some((h) => h.unavailable)
      || (snapshot.warnings ?? []).some((warning) => /late|price|market|stale|data source/i.test(warning)),
    priceDate:dates[0] ?? null, priceDates:dates,
  };
}
