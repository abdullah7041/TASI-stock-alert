import { describe, expect, test } from "vitest";
import { EvidenceStore } from "@/app/lib/evidence-store";
import { validateEvidenceRecord } from "@/app/lib/evidence-review-core.mjs";

function record() {
  const url = "https://www.saudiexchange.sa/filing";
  const metric = { raw_value: "1", prior_value: "1", grade: 3, explanation: "Reviewed filing evidence.", source_url: url };
  return validateEvidenceRecord({
    symbol: "1150", companyName: "Example", sector: "Banks", sectorKind: "operating", reportPeriod: "2026-Q1",
    publishedAt: "2026-08-10T08:00:00Z", retrievedAt: "2026-09-22T08:00:00Z", sourceName: "Saudi Exchange", sourceUrl: url,
    riskFlags: [], analystNotes: "Reviewed.",
    metrics: { profitability_direction: metric, cash_conversion: metric, leverage_resilience: metric, earnings_stability: metric, valuation_context: metric, downside_risk: metric, official_catalyst: metric },
  });
}

function memoryD1() {
  const rows: Array<{ revision_id: string; symbol: string; evidence_json: string; reviewed_at: string }> = [];
  return {
    batch: async () => [],
    prepare(sql: string) {
      return {
        bind(...values: string[]) {
          return {
            run: async () => {
              if (sql.startsWith("INSERT INTO evidence_records")) rows.push({ revision_id: values[0], symbol: values[2], evidence_json: values[4], reviewed_at: values[5] });
              return { success: true };
            },
            all: async () => ({ results: sql.startsWith("SELECT evidence_json") ? [...rows].reverse() : [] }),
          };
        },
        all: async () => ({ results: sql.startsWith("SELECT evidence_json") ? [...rows].reverse() : [] }),
      };
    },
  } as never;
}

describe("EvidenceStore", () => {
  test("keeps immutable reviewed revisions while exposing only the latest record per symbol", async () => {
    const store = new EvidenceStore(memoryD1());
    const first = await store.saveReviewed(record(), "owner");
    const second = await store.saveReviewed(record(), "owner");

    expect(second.revisionId).not.toBe(first.revisionId);
    expect(await store.current()).toEqual([record()]);
  });
});
