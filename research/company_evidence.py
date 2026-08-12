from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from urllib.parse import urlparse

REQUIRED_METRICS = {
    "operating": {"profitability_direction", "cash_conversion", "leverage_resilience", "earnings_stability"},
    "bank": {"roe_direction", "income_direction", "cost_efficiency", "asset_quality", "impairment_coverage", "capital_adequacy_pct", "liquidity"},
    "insurer": {"insurance_revenue_direction", "service_result_direction", "claims_quality", "csm_direction", "investment_quality", "solvency"},
    "reit": {"occupancy_pct", "rental_income_direction", "distribution_coverage", "leverage", "refinancing_risk", "concentration_risk", "nav_discount_pct"},
}
COMMON_METRICS = {"valuation_context", "downside_risk", "official_catalyst"}

@dataclass(frozen=True)
class MetricEvidence:
    raw_value: str; prior_value: str; grade: int; explanation: str; source_url: str

@dataclass(frozen=True)
class EvidenceRecord:
    symbol: str; company_name: str; sector: str; sector_kind: str; report_period: str
    published_at: str; retrieved_at: str; source_name: str; source_url: str
    metrics: dict[str, MetricEvidence]; risk_flags: tuple[str, ...]; analyst_notes: str

    @classmethod
    def from_dict(cls, value: dict) -> "EvidenceRecord":
        kind = value.get("sectorKind")
        if kind not in REQUIRED_METRICS: raise ValueError("unsupported sector kind")
        required = REQUIRED_METRICS[kind] | COMMON_METRICS
        missing = required - set(value.get("metrics") or {})
        if missing: raise ValueError(f"missing required metrics: {', '.join(sorted(missing))}")
        def https(url: str, field: str) -> str:
            if not isinstance(url, str) or urlparse(url).scheme != "https": raise ValueError(f"{field} must be HTTPS")
            return url
        metrics = {}
        for key in required:
            item = value["metrics"][key]
            if not isinstance(item, dict) or not isinstance(item.get("grade"), int) or not 0 <= item["grade"] <= 4: raise ValueError(f"{key} grade must be 0 through 4")
            if not all(isinstance(item.get(field), str) and item[field].strip() for field in ("raw_value", "prior_value", "explanation")): raise ValueError(f"{key} evidence is incomplete")
            metrics[key] = MetricEvidence(item["raw_value"], item["prior_value"], item["grade"], item["explanation"], https(item.get("source_url"), f"{key} source_url"))
        required_text = {"symbol":"symbol", "companyName":"company name", "sector":"sector", "reportPeriod":"report period", "publishedAt":"publishedAt", "retrievedAt":"retrievedAt", "sourceName":"source name", "analystNotes":"analyst notes"}
        for field, label in required_text.items():
            if not isinstance(value.get(field), str) or not value[field].strip(): raise ValueError(f"{label} is required")
        return cls(value["symbol"], value["companyName"], value["sector"], kind, value["reportPeriod"], value["publishedAt"], value["retrievedAt"], value["sourceName"], https(value.get("sourceUrl"), "sourceUrl"), metrics, tuple(value.get("riskFlags") or []), value["analystNotes"])

def load_evidence_records(records: list[dict], as_of: date) -> dict[str, EvidenceRecord]:
    loaded = {}
    for raw in records:
        record = EvidenceRecord.from_dict(raw)
        if datetime.fromisoformat(record.published_at.replace("Z", "+00:00")).date() > as_of: raise ValueError("filing published after score date")
        key = (record.symbol, record.report_period)
        if key in {(item.symbol, item.report_period) for item in loaded.values()}: raise ValueError("duplicate symbol/report period")
        loaded[record.symbol] = record
    return loaded
