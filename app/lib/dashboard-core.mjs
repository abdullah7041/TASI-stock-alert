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
  if (value.schemaVersion !== 1) throw new Error("Unsupported dashboard snapshot version.");
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
  return {
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
}

export function dashboardFreshness(snapshot, now = new Date()) {
  return snapshot.tradeDate >= expectedSnapshotDateInRiyadh(now) ? "current" : "stale";
}
