export type MarketPulseStatus = "available" | "partial" | "empty" | "failed";

export type MarketPulseQuote = {
  code: string;
  name: string;
  price: number;
  changePct: number | null;
  sessionVolume: number | null;
  observedAt: string;
  latency: "delayed-intraday";
};

export type MarketPulse = {
  schemaVersion: 1;
  artifactKind: "market-pulse";
  artifactId: `sha256:${string}`;
  asOf: string;
  dataStatus: "delayed-intraday";
  source: "yahoo";
  status: MarketPulseStatus;
  requested: string[];
  quotes: MarketPulseQuote[];
  errors: string[];
};

export function parseMarketPulse(value: unknown): MarketPulse;
