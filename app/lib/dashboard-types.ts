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
  expectedPriceDate?: string;
  indexUnavailable?: boolean;
  asOf: string;
  regime: string;
  dataStatus: "delayed-daily";
  warnings: string[];
  urgent: Array<{ code: string; name: string; action: string; price: number; reason: string; pnlPct: number }>;
  changed: Array<{ code: string; name: string; status: string; reason: string }>;
  qualified: Candidate[];
  researchCount: number;
  monthlyBudgetSar: number | null;
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
  // Not a literal. The producer tries providers in order and reports whichever
  // one answered, so pinning this to "gemini" made a working fallback fail
  // type-checking here -- the site rejecting a snapshot precisely because the
  // producer had successfully routed around an outage.
  provider: string;
  model?: string;
  reason?: string;
  calls_left?: number;
  // Each provider that was tried or skipped, with why. Present when the chain
  // did anything other than succeed first time.
  attempts?: { provider: string; reason: string; httpStatus?: number }[];
};

export type ChartBar = { date: string; Open: number; High: number; Low: number; Close: number; Volume: number };
export type Availability = 'available' | 'partial' | 'empty' | 'failed';
export type DigestRecord = {
  code:string; name:string; kind?:string; action?:string; price?:number; priceDate?:string; verified?:boolean;
  unrealized_pct?:number; reason?:string|string[];
  delta?:{price_pct?:number;rsi_delta?:number;trend_flipped?:boolean;rules_met_delta?:number;flipped?:string[]};
  rules_met?:number; rules_total?:number;
  rules?:Array<{rule:string;passed:boolean;available?:boolean;actual?:unknown;plain?:string}>;
  triggers?:Array<{rule?:string;plain?:string;reachable?:boolean;trigger_price?:number;pct_away?:number}>;
  news?:{ok:boolean;status?:Availability;headlines?:Array<{title:string;link?:string;published?:string}>;errors?:string[]};
  disclosures?:{ok:boolean;items?:Array<{title?:string;url?:string;link?:string;published?:string}>};
  lean?:Record<string,unknown>;
  decision?:{label:string;reason:string};
  [key:string]:unknown;
};
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
  digestRecords: DigestRecord[];
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
  marketPulse?: import("./market-pulse-core.mjs").MarketPulse | null;
  delivery?: DeliveryStatus;
};

export type DeliveryReceipt = { status: "confirmed" | "failed" | "unknown"; attemptedAt?: string; errorDetail?: string };
export type DeliveryStatus = {
  producer: DeliveryReceipt;
  discord: DeliveryReceipt;
  cockpit: DeliveryReceipt;
};
import type { ForecastView, MovementAlert, PortfolioView, Top10Proposal } from "@/app/lib/evidence-types";
