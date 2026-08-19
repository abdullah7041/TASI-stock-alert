// Company names for movement alerts. Plain JavaScript so both the TypeScript
// routes and dashboard-core.mjs (which node --test imports directly, without a
// bundler) can share one resolution rule.
//
// symbols.json is the verified symbol catalog the Python producer maintains:
// `config_name` is the short display name a human recognises, and `verified`
// means the code was confirmed against the data source. An unverified or
// missing entry deliberately yields no name at all — showing the numeric code
// as if it were a company name is the bug this module exists to prevent.
import symbols from "../../symbols.json" with { type: "json" };

export const NAME_UNAVAILABLE = "Company name unavailable";

const catalog = new Map(
  Object.entries(symbols)
    .filter(([, entry]) => entry && entry.verified === true && typeof entry.config_name === "string" && entry.config_name.trim())
    .map(([code, entry]) => [code, entry.config_name.trim()]),
);

export function verifiedCompanyName(code) {
  return catalog.get(String(code ?? "")) ?? null;
}

/** Resolve the display name of a stored alert that may predate the required name field. */
export function resolveAlertName(alert) {
  const stored = typeof alert?.name === "string" ? alert.name.trim() : "";
  return stored || verifiedCompanyName(alert?.code) || NAME_UNAVAILABLE;
}

/** Return a name-bearing alert, so no reader has to repeat the fallback rule. */
export function normalizeAlert(alert) {
  return { ...alert, name: resolveAlertName(alert) };
}
