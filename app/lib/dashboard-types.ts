export type Candidate = {
  code: string;
  name: string;
  relativeStrengthPct: number;
  squeeze: boolean;
  conditionsMet: 2;
};

export type DashboardSnapshot = {
  schemaVersion: 1;
  tradeDate: string;
  asOf: string;
  regime: string;
  dataStatus: "delayed-daily";
  warnings: string[];
  urgent: Array<{ code: string; name: string; action: string; price: number; reason: string; pnlPct: number }>;
  changed: Array<{ code: string; name: string; status: string; reason: string }>;
  qualified: Candidate[];
  researchCount: number;
  monthlyBudgetSar: number;
};

export type DashboardSnapshotV2 = Omit<DashboardSnapshot, "schemaVersion"> & {
  schemaVersion: 2;
  summary: string[];
  summaryV1?: SummaryV1;
  top10: Top10Proposal;
  portfolio: PortfolioView;
  alerts: MovementAlert[];
  forecast: ForecastView;
};

export type LeanStatus = {
  ok: boolean;
  provider: "gemini";
  model?: string;
  reason?: string;
  calls_left?: number;
};

export type ChartBar = { date: string; Open: number; High: number; Low: number; Close: number; Volume: number };
export type MarketChart =
  | { code: string; name: string; status: "unavailable"; reason: string }
  | { code: string; name: string; status: "available"; bars: ChartBar[]; levels: Partial<Record<"stop" | "trim" | "target", number>> };

/** DigestArtifactV3: one canonical payload for Discord and the cockpit. */
export type DashboardSnapshotV3 = Omit<DashboardSnapshotV2, "schemaVersion"> & {
  schemaVersion: 3;
  artifactKind: "digest";
  artifactId: `sha256:${string}`;
  scheduledFor: string | null;
  producer: { generatedAt: string };
  digestRecords: Array<{ code: string; name: string; lean?: Record<string, unknown>; [key: string]: unknown }>;
  leanStatus: LeanStatus;
  charts: MarketChart[];
  top10Review?: Top10Proposal | null;
};

export type SummaryCard = { kind: string; state: string; text: string };

export type SummaryV1 = {
  version: 1;
  generatedAt: string;
  scheduledFor: string | null;
  latenessMinutes: number | null;
  cards: SummaryCard[];
};

export type DashboardPayload = {
  snapshot: DashboardSnapshot | DashboardSnapshotV2 | DashboardSnapshotV3;
  freshness: "current" | "stale";
  alerts: MovementAlert[];
  delivery?: DeliveryStatus;
};

export type DeliveryReceipt = { status: "confirmed" | "failed" | "unknown"; attemptedAt?: string; errorDetail?: string };
export type DeliveryStatus = {
  producer: DeliveryReceipt;
  discord: DeliveryReceipt;
  cockpit: DeliveryReceipt;
};
import type { ForecastView, MovementAlert, PortfolioView, Top10Proposal } from "@/app/lib/evidence-types";
