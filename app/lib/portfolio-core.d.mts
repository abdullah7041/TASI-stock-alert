import type { PortfolioProposal, PortfolioView } from "@/app/lib/evidence-types";

export type PortfolioEvent = {
  operationId: string;
  kind: "contribution" | "buy" | "sell" | "cash_adjustment";
  confirmedAt: string;
  month?: string;
  code?: string;
  name?: string;
  shares?: number;
  priceSar?: number;
  cashSar?: number;
  feesSar?: number;
  reason?: string;
};

export function foldPortfolio(events: PortfolioEvent[]): Omit<PortfolioView, "proposal">;
export function proposeMonthlyAction(input: { cashSar: number; holdings: PortfolioView["holdings"]; approved: Array<{ code: string; name: string; totalScore: number; priceSar: number; stopDistancePct: number; owned: boolean }>; materialRisks: Array<{ code: string; reason: string; sharesToSell?: number }>; evidenceAsOf: string; priceAsOf: string }): Exclude<PortfolioProposal, null>;
