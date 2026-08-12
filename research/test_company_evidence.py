from datetime import date

import pytest

from research.company_evidence import EvidenceRecord, load_evidence_records


def valid_record(kind="operating", published_at="2026-08-10T12:00:00Z"):
    keys = {
        "operating": ["profitability_direction", "cash_conversion", "leverage_resilience", "earnings_stability"],
        "bank": ["roe_direction", "income_direction", "cost_efficiency", "asset_quality", "impairment_coverage", "capital_adequacy_pct", "liquidity"],
        "insurer": ["insurance_revenue_direction", "service_result_direction", "claims_quality", "csm_direction", "investment_quality", "solvency"],
        "reit": ["occupancy_pct", "rental_income_direction", "distribution_coverage", "leverage", "refinancing_risk", "concentration_risk", "nav_discount_pct"],
    }[kind] + ["valuation_context", "downside_risk", "official_catalyst"]
    return {"symbol": "1150", "companyName": "Example", "sector": "Banks", "sectorKind": kind, "reportPeriod": "2026-Q1", "publishedAt": published_at, "retrievedAt": "2026-08-11T12:00:00Z", "sourceName": "Saudi Exchange", "sourceUrl": "https://example.com/filing", "riskFlags": [], "analystNotes": "Primary-source review.", "metrics": {key: {"raw_value": "1", "prior_value": "1", "grade": 3, "explanation": "Improving", "source_url": "https://example.com/filing"} for key in keys}}


def test_bank_requires_asset_quality_and_capital_fields():
    record = valid_record("bank")
    del record["metrics"]["capital_adequacy_pct"]
    with pytest.raises(ValueError, match="capital_adequacy_pct"):
        EvidenceRecord.from_dict(record)


def test_future_filing_is_not_visible_to_an_earlier_score_date():
    record = valid_record(published_at="2026-08-12T12:00:00Z")
    with pytest.raises(ValueError, match="after score date"):
        load_evidence_records([record], as_of=date(2026, 8, 11))
