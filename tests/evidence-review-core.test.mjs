import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedOfficialUrl, validateEvidenceRecord } from "../app/lib/evidence-review-core.mjs";

function operatingRecord(url = "https://issuer.example.sa/report.pdf") {
  const metric = (grade) => ({ raw_value: "1", prior_value: "1", grade, explanation: "Reviewed filing evidence.", source_url: url });
  return {
    symbol: "1150", companyName: "Example", sector: "Banks", sectorKind: "operating", reportPeriod: "2026-Q1",
    publishedAt: "2026-08-10T08:00:00Z", retrievedAt: "2026-09-22T08:00:00Z", sourceName: "Issuer investor relations",
    sourceUrl: url, riskFlags: [], analystNotes: "Reviewed against the issuer filing.",
    metrics: { profitability_direction: metric(3), cash_conversion: metric(3), leverage_resilience: metric(3), earnings_stability: metric(3), valuation_context: metric(2), downside_risk: metric(2), official_catalyst: metric(1) },
  };
}

test("accepts a complete dated first-party evidence record from an allowed issuer host", () => {
  assert.equal(validateEvidenceRecord(operatingRecord(), ["issuer.example.sa"]).symbol, "1150");
});

test("rejects an evidence record from a host that the owner did not allow", () => {
  assert.throws(() => validateEvidenceRecord(operatingRecord("https://untrusted.example/report.pdf"), ["issuer.example.sa"]), /official source/i);
});

test("rejects an evidence record that omits a required sector metric", () => {
  const record = operatingRecord();
  delete record.metrics.cash_conversion;
  assert.throws(() => validateEvidenceRecord(record, ["issuer.example.sa"]), /cash_conversion/i);
});

test("admits only configured first-party hosts into the review queue", () => {
  assert.equal(isAllowedOfficialUrl("https://www.saudiexchange.sa/announcement", []), true);
  assert.equal(isAllowedOfficialUrl("https://untrusted.example/announcement", []), false);
});
