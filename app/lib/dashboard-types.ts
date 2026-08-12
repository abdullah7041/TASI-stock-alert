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
  top10: Top10Proposal;
  portfolio: PortfolioView;
  alerts: MovementAlert[];
  forecast: ForecastView;
};

export type DashboardPayload = { snapshot: DashboardSnapshot | DashboardSnapshotV2; freshness: "current" | "stale" };
import type { ForecastView, MovementAlert, PortfolioView, Top10Proposal } from "@/app/lib/evidence-types";
