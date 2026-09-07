import type { DashboardPayload, MarketChart, DigestRecord, Candidate } from './dashboard-types';
export type StockDecision = {
  code:string; name:string; owned:boolean;
  label:'Hold'|'Review stop'|'Review profit level'|'Watching'|'Insufficient data';
  reason:string; price:number|null; priceDate:string|null; dailyChange:number|null; pnl:number|null;
  conditionsMet:number|null; conditionsTotal:number|null; missing:string[];
  chart?:MarketChart; record:DigestRecord; shares:number|null; needsAttention:boolean; unavailable:boolean;
};
export function conditionReason(rule: { rule:string; actual?:unknown; plain?:string }): string;
export function buildDecisionView(snapshot:DashboardPayload['snapshot'], freshness:DashboardPayload['freshness']): {
  holdings:StockDecision[]; watchlist:StockDecision[]; candidates:Candidate[]; attention:number; incomplete:boolean; priceDate:string|null;
};
