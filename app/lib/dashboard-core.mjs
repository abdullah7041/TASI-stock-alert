import { resolveAlertName } from "./alert-names.mjs";

const RIYADH = "Asia/Riyadh";

function list(value, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be a list.`);
  return value;
}

function text(item, field) {
  if (typeof item[field] !== "string" || !item[field].trim()) throw new Error(`${field} is required.`);
  return item[field];
}

function number(item, field) {
  if (typeof item[field] !== "number" || !Number.isFinite(item[field])) throw new Error(`${field} must be a number.`);
  return item[field];
}

function tradeDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("tradeDate must use YYYY-MM-DD.");
  return value;
}

function timestamp(value, field) {
  const result = text({ [field]: value }, field);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${field} must be a valid timestamp.`);
  return result;
}

function nonNegative(item, field) {
  const value = number(item, field);
  if (value < 0) throw new Error(`${field} must not be negative.`);
  return value;
}

function enumValue(value, field, values) {
  if (!values.includes(value)) throw new Error(`${field} is invalid.`);
  return value;
}

function riyadhParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RIYADH, year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function previousTradingDate(date) {
  const cursor = new Date(`${date}T00:00:00Z`);
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  } while (![0, 1, 2, 3, 4].includes(cursor.getUTCDay()));
  return cursor.toISOString().slice(0, 10);
}

function expectedSnapshotDateInRiyadh(now) {
  const current = riyadhParts(now);
  const isTradingDay = ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(current.weekday);
  const beforeDeadline = current.hour < 10 || (current.hour === 10 && current.minute < 15);
  return isTradingDay && !beforeDeadline ? current.date : previousTradingDate(current.date);
}

export function parseDashboardSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Dashboard snapshot must be an object.");
  if (![1, 2].includes(value.schemaVersion)) throw new Error("Unsupported dashboard snapshot version.");
  if (value.dataStatus !== "delayed-daily") throw new Error("Dashboard data must be labelled delayed-daily.");
  const asOf = text(value, "asOf");
  if (!Number.isFinite(Date.parse(asOf))) throw new Error("asOf must be a valid timestamp.");
  const qualified = list(value.qualified, "qualified").map((item) => {
    if (!item || typeof item !== "object" || item.conditionsMet !== 2) throw new Error("Research candidates must meet two conditions.");
    return { code: text(item, "code"), name: text(item, "name"), relativeStrengthPct: number(item, "relativeStrengthPct"), squeeze: item.squeeze === true, conditionsMet: 2 };
  });
  const urgent = list(value.urgent, "urgent").map((item) => ({ code: text(item, "code"), name: text(item, "name"), action: text(item, "action"), price: number(item, "price"), reason: text(item, "reason"), pnlPct: number(item, "pnlPct") }));
  const changed = list(value.changed, "changed").map((item) => ({ code: text(item, "code"), name: text(item, "name"), status: text(item, "status"), reason: text(item, "reason") }));
  const warnings = list(value.warnings, "warnings").map((warning) => {
    if (typeof warning !== "string" || !warning.trim()) throw new Error("warnings must contain text.");
    return warning;
  });
  const common = {
    schemaVersion: 1,
    tradeDate: tradeDate(value.tradeDate),
    asOf,
    regime: text(value, "regime"),
    dataStatus: "delayed-daily",
    warnings,
    urgent,
    changed,
    qualified,
    researchCount: number(value, "researchCount"),
    monthlyBudgetSar: number(value, "monthlyBudgetSar"),
  };
  if (value.schemaVersion === 1) return common;
  const sourceStamp = (item) => ({
    source: text(item, "source"), observedAt: timestamp(item.observedAt, "observedAt"),
    receivedAt: timestamp(item.receivedAt, "receivedAt"),
    latency: enumValue(item.latency, "latency", ["delayed-intraday", "delayed-daily", "official-filing", "manual"]),
    freshness: enumValue(item.freshness, "freshness", ["current", "stale", "unknown"]),
    ...(typeof item.url === "string" && item.url ? { url: item.url } : {}),
  });
  const top10 = value.top10;
  if (!top10 || typeof top10 !== "object") throw new Error("top10 must be an object.");
  const entries = list(top10.entries, "top10.entries").map((entry) => ({
    code: text(entry, "code"), name: text(entry, "name"), sector: text(entry, "sector"), owned: entry.owned === true,
    totalScore: nonNegative(entry, "totalScore"), reasons: list(entry.reasons, "reasons").map((reason) => text({ reason }, "reason")), evidence: sourceStamp(entry.evidence),
  }));
  const portfolio = value.portfolio;
  if (!portfolio || typeof portfolio !== "object") throw new Error("portfolio must be an object.");
  const alerts = list(value.alerts, "alerts").map((alert) => ({
    alertId: text(alert, "alertId"), code: text(alert, "code"), name: resolveAlertName(alert), direction: enumValue(alert.direction, "direction", ["upside", "downside"]),
    observedAt: timestamp(alert.observedAt, "observedAt"), receivedAt: timestamp(alert.receivedAt, "receivedAt"),
    latency: enumValue(alert.latency, "latency", ["delayed-intraday"]), excessMovePct: number(alert, "excessMovePct"), robustZ: number(alert, "robustZ"),
    ...(typeof alert.volumeRatio === "number" ? { volumeRatio: nonNegative(alert, "volumeRatio") } : {}), reason: text(alert, "reason"),
  }));
  const forecast = value.forecast;
  if (!forecast || typeof forecast !== "object") throw new Error("forecast must be an object.");
  const parsedForecast = forecast.status === "unavailable"
    ? { status: "unavailable", asOf: tradeDate(forecast.asOf), reason: text(forecast, "reason") }
    : { status: "available", asOf: tradeDate(forecast.asOf), target: nonNegative(forecast, "target"), stop: nonNegative(forecast, "stop"), horizonSessions: 60, targetFirstPct: nonNegative(forecast, "targetFirstPct"), confidence: enumValue(forecast.confidence, "confidence", ["low", "medium", "high"]), modelVersion: text(forecast, "modelVersion") };
  let summaryV1;
  if (value.summaryV1 !== undefined) {
    const summary = value.summaryV1;
    if (!summary || typeof summary !== "object" || summary.version !== 1) throw new Error("summaryV1 version is invalid.");
    summaryV1 = {
      version: 1,
      generatedAt: timestamp(summary.generatedAt, "summaryV1.generatedAt"),
      scheduledFor: summary.scheduledFor === null ? null : timestamp(summary.scheduledFor, "summaryV1.scheduledFor"),
      latenessMinutes: summary.latenessMinutes === null ? null : nonNegative(summary, "latenessMinutes"),
      cards: list(summary.cards, "summaryV1.cards").map((card) => ({
        kind: text({ kind: card.kind }, "kind"),
        state: text({ state: card.state }, "state"),
        text: text({ text: card.text }, "text"),
      })),
    };
  }
  return {
    ...common, schemaVersion: 2, summary: list(value.summary, "summary").map((line) => text({ line }, "line")),
    top10: { proposalId: text(top10, "proposalId"), status: enumValue(top10.status, "top10.status", ["draft", "approved", "rejected"]), researchedAt: timestamp(top10.researchedAt, "top10.researchedAt"), entries },
    portfolio: { confirmedAt: timestamp(portfolio.confirmedAt, "portfolio.confirmedAt"), cashSar: nonNegative(portfolio, "cashSar"), contributionMonth: portfolio.contributionMonth === null ? null : text(portfolio, "contributionMonth"), holdings: list(portfolio.holdings, "portfolio.holdings").map((holding) => ({ code: text(holding, "code"), name: text(holding, "name"), shares: nonNegative(holding, "shares"), ...(typeof holding.avgCostSar === "number" ? { avgCostSar: nonNegative(holding, "avgCostSar") } : {}) })), proposal: portfolio.proposal === null ? null : portfolio.proposal },
    ...(summaryV1 ? { summaryV1 } : {}), alerts, forecast: parsedForecast,
  };
}

export function dashboardFreshness(snapshot, now = new Date()) {
  return snapshot.tradeDate >= expectedSnapshotDateInRiyadh(now) ? "current" : "stale";
}
