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
export type SavedPortfolio = {
  schemaVersion: 3; status: 'saved'|'empty'; eventCount: number;
  events: import('./portfolio-core.mjs').PortfolioEvent[];
  view: Omit<PortfolioView,'confirmedAt'> & {confirmedAt:string|null};
};

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
  cashSar: number | null;
  contributionMonth: string | null;
  holdings: PortfolioHolding[];
  proposal: PortfolioProposal;
  policyStatus?: "unconfigured";
  accountBook?: PortfolioBook;
  savedPortfolio?: SavedPortfolio;
};

export type BrokerAccountId = "al_rajhi" | "al_ahli";
export type AccountEventPayload = {
  kind: "opening_balance" | "contribution" | "buy" | "sell" | "withdrawal" | "dividend" | "fee";
  occurredAt: string;
  provenance: { source: "manual"; reference?: string };
  cashSar?: number;
  holdings?: PortfolioHolding[];
  code?: string;
  name?: string;
  shares?: number;
  priceSar?: number;
  feesSar?: number;
  reason?: string;
};
export type AccountRecordInput = { operationId: string } & (
  | { kind: "event"; payload: AccountEventPayload }
  | { kind: "correction"; payload: { targetOperationId: string; replacement: AccountEventPayload | null; reason: string } }
  | { kind: "reconciliation"; payload: { statementAsOf: string; cashSar: number; holdings: Array<{ code: string; shares: number }>; reference: string } }
);
export type AccountRecord = AccountRecordInput & { accountId: BrokerAccountId; revision: number; recordedAt: string };
export type ReconciliationDifference = { field: "cash" | "shares"; code?: string; ledger: number; statement: number; difference: number };
export type PortfolioAccountView = {
  accountId: BrokerAccountId;
  revision: number;
  initialized: boolean;
  cashSar: number | null;
  confirmedAt: string | null;
  contributionMonth: string | null;
  holdings: PortfolioHolding[];
  realisedSar: number | null;
  lastReconciledAt: string | null;
  reconciliationStatementAsOf: string | null;
  reconciliationStatus: "unreconciled" | "matched" | "discrepancy" | "needs_review";
  discrepancies: ReconciliationDifference[];
  historyComplete: boolean;
  quantityBlockers: string[];
  proposal: null;
  records: AccountRecord[];
  error?: string;
};
export type PortfolioBook = {
  schemaVersion: 1;
  policyStatus: "unconfigured";
  accounts: PortfolioAccountView[];
  combined: { cashSar: number | null; complete: boolean; spendable: false; confirmedAt: Array<{ accountId: BrokerAccountId; confirmedAt: string | null }> };
  legacy: { status: "unassigned"; events: unknown[] };
};
export type AccountPreview = { record: AccountRecordInput; expectedRevision: number; projected: PortfolioAccountView; differences: ReconciliationDifference[] };

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
