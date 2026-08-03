export type DashboardFixture = {
  asOf: string;
  dataStatus: "preview-delayed";
  urgent: Array<{
    code: string;
    name: string;
    action: string;
    price: number;
    reason: string;
    pnlPct: number;
  }>;
  changed: Array<{ code: string; name: string; status: string; reason: string }>;
  qualified: Array<{ code: string; name: string; relativeStrengthPct: number; squeeze: boolean }>;
  researchCount: number;
};

export const dashboardFixture: DashboardFixture = {
  asOf: "03 Aug 2026 · 09:40 AST",
  dataStatus: "preview-delayed",
  urgent: [
    {
      code: "2320",
      name: "Al-Babtain",
      action: "SELL (STOP)",
      price: 55.85,
      reason: "The delayed daily close is below your 58.37 SAR stop. This keeps the original risk limit intact.",
      pnlPct: -13.1,
    },
  ],
  changed: [],
  qualified: [
    {
      code: "1150",
      name: "Alinma Bank",
      relativeStrengthPct: 10.4,
      squeeze: true,
    },
  ],
  researchCount: 7,
};
