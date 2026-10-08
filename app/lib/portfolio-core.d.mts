import type { PortfolioProposal, PortfolioView, BrokerAccountId, AccountRecord, AccountRecordInput, PortfolioAccountView, PortfolioBook, AccountPreview } from "@/app/lib/evidence-types";

export type PortfolioEvent = {
  operationId: string;
  kind: "opening_balance" | "opening_position" | "contribution" | "buy" | "sell" | "cash_adjustment" | "withdrawal" | "dividend" | "fee";
  confirmedAt: string;
  month?: string;
  code?: string;
  name?: string;
  shares?: number;
  priceSar?: number;
  cashSar?: number;
  feesSar?: number;
  reason?: string;
  holdings?: PortfolioView["holdings"];
};

export function expandPortfolioEvent(existing: PortfolioEvent[], event: PortfolioEvent): PortfolioEvent[];
export function foldPortfolio(events: PortfolioEvent[]): Omit<PortfolioView, "proposal">;
export function proposeMonthlyAction(input: { cashSar: number; holdings: PortfolioView["holdings"]; approved: Array<{ code: string; name: string; totalScore: number; priceSar: number; stopDistancePct: number; owned: boolean }>; materialRisks: Array<{ code: string; reason: string; sharesToSell?: number }>; evidenceAsOf: string; priceAsOf: string }): Exclude<PortfolioProposal, null>;
export const brokerAccountIds: BrokerAccountId[];
export class PortfolioConflict extends Error {}
export function normalizeAccountRecordInput(input: unknown): AccountRecordInput;
export function foldAccountRecords(records: AccountRecord[], accountId: BrokerAccountId): PortfolioAccountView;
export function buildPortfolioBook(records: AccountRecord[], legacyEvents: unknown[]): PortfolioBook;
export function previewAccountRecord(records: AccountRecord[], accountId: BrokerAccountId, input: unknown, expectedRevision: number): AccountPreview;
