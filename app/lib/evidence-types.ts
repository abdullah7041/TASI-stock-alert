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
  approvedAt?: string;
  nextReviewAt?: string;
  reviewWindow?: "1-3 months";
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
  /** Display name of the company. Required: a bare code is not a readable alert. */
  name: string;
  direction: "upside" | "downside";
  observedAt: string;
  receivedAt: string;
  latency: "delayed-intraday";
  excessMovePct: number;
  robustZ: number;
  volumeRatio?: number;
  reason: string;
};

/**
 * An alert as it sits in storage. Alerts written before the name became
 * required have no name, so every read path normalizes before rendering.
 */
export type StoredMovementAlert = Omit<MovementAlert, "name"> & { name?: string };

export type ForecastView =
  | { status: "unavailable"; asOf: string; reason: string }
  | { status: "available"; asOf: string; target: number; stop: number; horizonSessions: 60; targetFirstPct: number; confidence: "low" | "medium" | "high"; modelVersion: string };
