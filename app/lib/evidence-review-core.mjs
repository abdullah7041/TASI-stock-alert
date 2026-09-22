const REQUIRED = {
  operating: ["profitability_direction", "cash_conversion", "leverage_resilience", "earnings_stability"],
  bank: ["roe_direction", "income_direction", "cost_efficiency", "asset_quality", "impairment_coverage", "capital_adequacy_pct", "liquidity"],
  insurer: ["insurance_revenue_direction", "service_result_direction", "claims_quality", "csm_direction", "investment_quality", "solvency"],
  reit: ["occupancy_pct", "rental_income_direction", "distribution_coverage", "leverage", "refinancing_risk", "concentration_risk", "nav_discount_pct"],
};
const COMMON = ["valuation_context", "downside_risk", "official_catalyst"];

function text(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

export function isAllowedOfficialUrl(value, issuerHosts = []) {
  let parsed;
  try { parsed = new URL(value); } catch { return false; }
  const allowedHosts = new Set(["saudiexchange.sa", "www.saudiexchange.sa", ...issuerHosts.map((host) => String(host).toLowerCase())]);
  return parsed.protocol === "https:" && allowedHosts.has(parsed.hostname.toLowerCase());
}

function officialUrl(value, allowedHosts, field) {
  let parsed;
  try { parsed = new URL(text(value, field)); } catch { throw new Error(`${field} must be an HTTPS official source URL.`); }
  if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname.toLowerCase())) throw new Error(`${field} must use an allowed official source.`);
  return parsed.toString();
}

function timestamp(value, field) {
  const result = text(value, field);
  if (!Number.isFinite(Date.parse(result))) throw new Error(`${field} must be a valid timestamp.`);
  return result;
}

export function validateEvidenceRecord(value, issuerHosts = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Evidence record must be an object.");
  const kind = text(value.sectorKind, "sectorKind");
  if (!Object.hasOwn(REQUIRED, kind)) throw new Error("sectorKind is invalid.");
  const allowedHosts = new Set(["saudiexchange.sa", "www.saudiexchange.sa", ...issuerHosts.map((host) => String(host).toLowerCase())]);
  const publishedAt = timestamp(value.publishedAt, "publishedAt");
  const retrievedAt = timestamp(value.retrievedAt, "retrievedAt");
  if (Date.parse(publishedAt) > Date.parse(retrievedAt)) throw new Error("publishedAt cannot be after retrievedAt.");
  const metrics = value.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new Error("metrics are required.");
  const required = [...REQUIRED[kind], ...COMMON];
  const parsedMetrics = {};
  for (const key of required) {
    const metric = metrics[key];
    if (!metric || typeof metric !== "object" || Array.isArray(metric)) throw new Error(`${key} is required.`);
    if (!Number.isInteger(metric.grade) || metric.grade < 0 || metric.grade > 4) throw new Error(`${key} grade must be 0 through 4.`);
    parsedMetrics[key] = {
      raw_value: text(metric.raw_value, `${key}.raw_value`), prior_value: text(metric.prior_value, `${key}.prior_value`),
      grade: metric.grade, explanation: text(metric.explanation, `${key}.explanation`),
      source_url: officialUrl(metric.source_url, allowedHosts, `${key}.source_url`),
    };
  }
  return {
    symbol: text(value.symbol, "symbol"), companyName: text(value.companyName, "companyName"), sector: text(value.sector, "sector"), sectorKind: kind,
    reportPeriod: text(value.reportPeriod, "reportPeriod"), publishedAt, retrievedAt, sourceName: text(value.sourceName, "sourceName"),
    sourceUrl: officialUrl(value.sourceUrl, allowedHosts, "sourceUrl"), riskFlags: Array.isArray(value.riskFlags) ? value.riskFlags.map((flag) => text(flag, "riskFlags")) : [],
    analystNotes: text(value.analystNotes, "analystNotes"), metrics: parsedMetrics,
  };
}
