import type { DashboardPayload } from "./dashboard-types";
import type { MovementAlert } from "./evidence-types";

export type EventReaction = {
  id: string;
  title: string;
  sourceUrl: string;
  sourceClass: "official" | "trusted";
  verification: "verified";
  publishedAt: string | null;
  reactionWindow: "daily-close" | "delayed-intraday";
  causation: "not-proven";
  related: Array<{
    code: string;
    name: string;
    changePct: number | null;
    price: number | null;
    priceDate: string | null;
    observedAt: string | null;
    reactionWindow: "daily-close" | "delayed-intraday";
  }>;
  breadth: { positive: number; negative: number; unavailable: number };
};

export type MarketAnomaly = MovementAlert & {
  status: "unexplained" | "event-linked";
  newsStatus: "available" | "empty" | "failed";
  volumeConfirmed: boolean;
  explanation: string;
};

export function buildMarketIntelligence(
  snapshot: DashboardPayload["snapshot"],
  alerts: MovementAlert[],
  marketPulse?: DashboardPayload["marketPulse"],
): { events: EventReaction[]; anomalies: MarketAnomaly[] };
