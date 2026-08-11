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

export type DashboardPayload = { snapshot: DashboardSnapshot; freshness: "current" | "stale" };
