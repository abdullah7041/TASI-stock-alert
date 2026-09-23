const ARTIFACT_ID = /^sha256:[a-f0-9]{64}$/;
const STATUSES = new Set(["available", "partial", "empty", "failed"]);

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function timestamp(value, label) {
  nonEmptyString(value, label);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${label} must be a valid timestamp.`);
  return value;
}

function optionalFinite(value, label, { minimum = -Infinity } = {}) {
  if (value === null) return value;
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${label} must be null or a finite number.`);
  return value;
}

export function parseMarketPulse(value) {
  const pulse = record(value, "Market pulse");
  if (pulse.schemaVersion !== 1 || pulse.artifactKind !== "market-pulse") {
    throw new Error("Unsupported market pulse schema.");
  }
  if (typeof pulse.artifactId !== "string" || !ARTIFACT_ID.test(pulse.artifactId)) {
    throw new Error("Market pulse needs a valid artifactId.");
  }
  timestamp(pulse.asOf, "Market pulse asOf");
  if (pulse.dataStatus !== "delayed-intraday" || pulse.source !== "yahoo") {
    throw new Error("Market pulse must use the delayed Yahoo source contract.");
  }
  if (!STATUSES.has(pulse.status)) throw new Error("Unsupported market pulse status.");
  if (!Array.isArray(pulse.requested) || !pulse.requested.every((code) => typeof code === "string" && code.trim())) {
    throw new Error("Market pulse requested must be a string array.");
  }
  if (!Array.isArray(pulse.errors) || !pulse.errors.every((error) => typeof error === "string")) {
    throw new Error("Market pulse errors must be a string array.");
  }
  if (!Array.isArray(pulse.quotes)) throw new Error("Market pulse quotes must be an array.");
  for (const rawQuote of pulse.quotes) {
    const quote = record(rawQuote, "Market pulse quote");
    nonEmptyString(quote.code, "Quote code");
    nonEmptyString(quote.name, "Quote name");
    if (!Number.isFinite(quote.price) || quote.price <= 0) throw new Error("Quote price must be positive and finite.");
    optionalFinite(quote.changePct, "Quote changePct");
    optionalFinite(quote.sessionVolume, "Quote sessionVolume", { minimum: 0 });
    timestamp(quote.observedAt, "Quote observedAt");
    if (quote.latency !== "delayed-intraday") throw new Error("Quote latency must be delayed-intraday.");
  }
  if ((pulse.status === "failed" || pulse.status === "empty") && pulse.quotes.length) {
    throw new Error(`${pulse.status} market pulse cannot contain quotes.`);
  }
  if (pulse.status === "available" && pulse.quotes.length === 0) {
    throw new Error("Available market pulse must contain quotes.");
  }
  return value;
}
