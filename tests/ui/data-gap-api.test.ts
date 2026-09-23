import { afterEach, expect, test, vi } from "vitest";
import { env } from "./cloudflare-workers-stub";
import { GET as getPulse } from "@/app/api/market-pulse/route";
import { POST as ingestPulse } from "@/app/api/market-pulse/ingest/route";
import { POST as reviewEvidence } from "@/app/api/evidence/records/route";
import { EvidenceStore } from "@/app/lib/evidence-store";
import { ObservationalPulseStore } from "@/app/lib/observational-pulse-store";

afterEach(() => { vi.restoreAllMocks(); for (const key of Object.keys(env)) delete env[key]; });

function request(path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://example.test${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
}

const pulse = {
  schemaVersion: 1, artifactKind: "market-pulse", status: "unavailable", source: "yahoo-probe",
  dataStatus: "delayed-intraday", intervalMinutes: 5, declaredDelayMinutes: 15,
  fetchedAt: "2026-09-22T07:20:00Z", coverage: { tracked: 1, usable: 0, required: 1 },
  observations: [], reason: "No qualified index bar.", regime: { status: "unavailable", reason: "No qualified daily series." },
};

function record(url = "https://www.saudiexchange.sa/filing") {
  const metric = { raw_value: "1", prior_value: "1", grade: 2, explanation: "Reviewed filing.", source_url: url };
  return {
    symbol: "1150", companyName: "Example", sector: "Banks", sectorKind: "operating", reportPeriod: "2026-Q1",
    publishedAt: "2026-08-10T08:00:00Z", retrievedAt: "2026-09-22T08:00:00Z", sourceName: "Saudi Exchange", sourceUrl: url,
    riskFlags: [], analystNotes: "Reviewed.", metrics: {
      profitability_direction: metric, cash_conversion: metric, leverage_resilience: metric,
      earnings_stability: metric, valuation_context: metric, downside_risk: metric, official_catalyst: metric,
    },
  };
}

test("observation ingest requires machine authentication and stores only valid pulses", async () => {
  env.DB = {}; env.DASHBOARD_INGEST_TOKEN = "test-only";
  const save = vi.spyOn(ObservationalPulseStore.prototype, "save").mockResolvedValue();
  expect((await ingestPulse(request("/api/market-pulse/ingest", pulse))).status).toBe(401);
  expect(save).not.toHaveBeenCalled();
  expect((await ingestPulse(request("/api/market-pulse/ingest", { ...pulse, status: "current" }, { authorization: "Bearer test-only" }))).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
  expect((await ingestPulse(request("/api/market-pulse/ingest", pulse, { authorization: "Bearer test-only" }))).status).toBe(200);
  expect(save).toHaveBeenCalledOnce();
});

test("observation read is owner-only", async () => {
  env.DB = {}; env.AGENT_OWNER_EMAIL = "owner@example.test";
  vi.spyOn(ObservationalPulseStore.prototype, "latest").mockResolvedValue(pulse as never);
  expect((await getPulse(request("/api/market-pulse"))).status).toBe(401);
  expect((await getPulse(request("/api/market-pulse", undefined, { "oai-authenticated-user-id": "other", "oai-authenticated-user-email": "other@example.test" }))).status).toBe(403);
  const response = await getPulse(request("/api/market-pulse", undefined, { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.test" }));
  expect(response.status).toBe(200);
  expect((await response.json()).pulse.status).toBe("unavailable");
});

test("reviewed exchange evidence must first appear in the official queue", async () => {
  env.DB = {}; env.AGENT_OWNER_EMAIL = "owner@example.test";
  const save = vi.spyOn(EvidenceStore.prototype, "saveReviewed").mockResolvedValue({ revisionId: "new", reviewedAt: "2026-09-23T00:00:00Z", record: record() } as never);
  const queue = vi.spyOn(EvidenceStore.prototype, "queue").mockResolvedValue([]);
  const headers = { "oai-authenticated-user-id": "owner", "oai-authenticated-user-email": "owner@example.test" };
  expect((await reviewEvidence(request("/api/evidence/records", record(), headers))).status).toBe(400);
  expect(save).not.toHaveBeenCalled();
  queue.mockResolvedValue([{ title: "Filing", url: "https://www.saudiexchange.sa/filing", retrieved_at: "2026-09-22T08:00:00Z" }]);
  expect((await reviewEvidence(request("/api/evidence/records", record(), headers))).status).toBe(201);
  expect(save).toHaveBeenCalledOnce();
});
