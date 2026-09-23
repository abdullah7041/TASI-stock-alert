export function parseObservationalPulse(value: unknown): {
  schemaVersion: 1;
  artifactKind: "market-pulse";
  status: "current" | "stale" | "unavailable";
  source: string;
  dataStatus: "delayed-intraday";
  intervalMinutes: number;
  declaredDelayMinutes: number;
  fetchedAt: string;
  coverage: { tracked: number; usable: number; required: number };
  observations: { code: string; price: number; changePct: number; latestBarAt: string }[];
  reason?: string;
  lastValidAt?: string;
  observedAt?: string;
  index?: { code: string; price: number; changePct: number; latestBarAt: string };
  regime: { status: "available"; label: string; bars: number } | { status: "unavailable"; reason: string };
};
