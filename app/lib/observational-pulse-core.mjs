const states = ["current", "stale", "unavailable"];

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value;
}

function timestamp(value, field) {
  const result = text(value, field);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${field} must be a valid timestamp.`);
  return result;
}

function number(value, field, minimum = -Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new Error(`${field} is invalid.`);
  return value;
}

function coverage(value) {
  if (!value || typeof value !== "object") throw new Error("coverage is required.");
  const tracked = number(value.tracked, "coverage.tracked", 0);
  const usable = number(value.usable, "coverage.usable", 0);
  const required = number(value.required, "coverage.required", 0);
  if (!Number.isInteger(tracked) || !Number.isInteger(usable) || !Number.isInteger(required) || usable > tracked || required > tracked) {
    throw new Error("coverage is invalid.");
  }
  return { tracked, usable, required };
}

function observation(value) {
  if (!value || typeof value !== "object") throw new Error("observation is invalid.");
  return {
    code: text(value.code, "observation.code"), price: number(value.price, "observation.price", 0),
    changePct: number(value.changePct, "observation.changePct"), latestBarAt: timestamp(value.latestBarAt, "latestBarAt"),
  };
}

function completedRecent(barAt, fetchedAt, intervalMinutes, declaredDelayMinutes) {
  const ageMinutes = (Date.parse(fetchedAt) - Date.parse(barAt)) / 60_000;
  if (ageMinutes < intervalMinutes) throw new Error("A current pulse requires a completed five-minute bar.");
  if (ageMinutes > declaredDelayMinutes + intervalMinutes * 2) throw new Error("A current pulse requires a recent completed bar.");
}

export function parseObservationalPulse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Market pulse must be an object.");
  if (value.schemaVersion !== 1 || value.artifactKind !== "market-pulse") throw new Error("Unsupported market pulse version.");
  const status = states.includes(value.status) ? value.status : (() => { throw new Error("market pulse status is invalid."); })();
  const common = {
    schemaVersion: 1, artifactKind: "market-pulse", status, source: text(value.source, "source"),
    dataStatus: value.dataStatus === "delayed-intraday" ? value.dataStatus : (() => { throw new Error("Market pulse must be delayed-intraday."); })(),
    intervalMinutes: number(value.intervalMinutes, "intervalMinutes", 1),
    declaredDelayMinutes: number(value.declaredDelayMinutes, "declaredDelayMinutes", 0),
    fetchedAt: timestamp(value.fetchedAt, "fetchedAt"), coverage: coverage(value.coverage),
    observations: Array.isArray(value.observations) ? value.observations.map(observation) : (() => { throw new Error("observations must be a list."); })(),
  };
  const regime = value.regime;
  if (!regime || typeof regime !== "object" || !["available", "unavailable"].includes(regime.status)) throw new Error("regime is invalid.");
  const parsedRegime = regime.status === "available"
    ? { status: "available", label: ["ok", "breakdown", "unknown"].includes(regime.label) ? regime.label : (() => { throw new Error("regime label is invalid."); })(), bars: number(regime.bars, "regime.bars", 52) }
    : { status: "unavailable", reason: text(regime.reason, "regime.reason") };
  if (status === "unavailable") {
    if (common.observations.length) throw new Error("Unavailable pulse cannot claim usable observations.");
    return { ...common, reason: text(value.reason, "reason"), regime: parsedRegime };
  }
  if (!value.index || typeof value.index !== "object") throw new Error("current market pulse needs an index.");
  const index = { code: text(value.index.code, "index.code"), price: number(value.index.price, "index.price", 0), changePct: number(value.index.changePct, "index.changePct"), latestBarAt: timestamp(value.index.latestBarAt, "latestBarAt") };
  if (status === "stale") {
    const lastValidAt = timestamp(value.lastValidAt, "lastValidAt");
    if (Date.parse(lastValidAt) > Date.parse(common.fetchedAt)) throw new Error("lastValidAt cannot be after fetch time.");
    return { ...common, reason: text(value.reason, "reason"), lastValidAt, index, regime: parsedRegime };
  }
  if (index.code !== "^TASI.SR") throw new Error("Current pulse requires the TASI index.");
  if (common.coverage.required < Math.ceil(common.coverage.tracked * 0.7)
      || common.coverage.usable < common.coverage.required
      || common.coverage.usable !== common.observations.length) throw new Error("Current pulse coverage is below 70%.");
  const observedAt = timestamp(value.observedAt, "observedAt");
  if (observedAt !== index.latestBarAt) throw new Error("Index completed-bar time must match observedAt.");
  completedRecent(index.latestBarAt, common.fetchedAt, common.intervalMinutes, common.declaredDelayMinutes);
  for (const item of common.observations) completedRecent(item.latestBarAt, common.fetchedAt, common.intervalMinutes, common.declaredDelayMinutes);
  return { ...common, observedAt, index, regime: parsedRegime };
}
