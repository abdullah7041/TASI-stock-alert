export type Freshness = "current" | "stale" | "unknown";
export type Latency = "delayed-intraday" | "delayed-daily" | "official-filing" | "manual";

export type SourceStamp = {
  source: string;
  observedAt: string;
  receivedAt: string;
  latency: Latency;
  freshness: Freshness;
  url?: string;
};

export type Top10Entry = {
  code: string;
  name: string;
  sector: string;
  owned: boolean;
  totalScore: number;
  reasons: string[];
  evidence: SourceStamp;
};

export type Top10Proposal = {
  proposalId: string;
  status: "draft" | "approved" | "rejected";
  researchedAt: string;
  entries: Top10Entry[];
};

export type PortfolioHolding = { code: string; name: string; shares: number; avgCostSar?: number };

export type PortfolioProposal = {
  action: "buy" | "add" | "hold" | "trim" | "sell" | "hold_cash";
  code?: string;
  shares?: number;
  estimatedSpendSar?: number;
  reason: string;
  requiresConfirmation: true;
} | null;

export type PortfolioView = {
  confirmedAt: string;
  cashSar: number;
  contributionMonth: string | null;
  holdings: PortfolioHolding[];
  proposal: PortfolioProposal;
};

export type MovementAlert = {
  alertId: string;
  code: string;
  direction: "upside" | "downside";
  observedAt: string;
  receivedAt: string;
  latency: "delayed-intraday";
  excessMovePct: number;
  robustZ: number;
  volumeRatio?: number;
  reason: string;
};

export type ForecastView =
  | { status: "unavailable"; asOf: string; reason: string }
  | { status: "available"; asOf: string; target: number; stop: number; horizonSessions: 60; targetFirstPct: number; confidence: "low" | "medium" | "high"; modelVersion: string };
