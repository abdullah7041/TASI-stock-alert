from __future__ import annotations

from dataclasses import dataclass

HARD_EXCLUSIONS = {"auditor_qualification", "restatement", "trading_suspension", "severe_liquidity", "material_governance"}
WEIGHTS = {"fundamental_direction": 30.0, "quality_resilience": 25.0, "swing_timing": 25.0, "valuation_downside": 10.0, "official_catalyst": 10.0}

@dataclass(frozen=True)
class ScoredCompany:
    symbol: str
    name: str
    sector: str
    total_score: float
    owned: bool
    eligible: bool
    reasons: tuple[str, ...]

def score_company(symbol, name, sector, owned, evidence, relative_strength_pct, trend_up, reward_risk):
    if set(evidence.risk_flags) & HARD_EXCLUSIONS:
        return ScoredCompany(symbol, name, sector, 0.0, owned, False, ("material risk flag",))
    metrics = evidence.metrics
    grades = [metric.grade / 4 for metric in metrics.values()]
    fundamental = sum(grades) / len(grades)
    quality = fundamental
    timing = 0.50 * min(max(relative_strength_pct / 25, 0), 1) + 0.30 * float(trend_up) + 0.20 * min(max(reward_risk / 2, 0), 1)
    valuation = (metrics["valuation_context"].grade + metrics["downside_risk"].grade) / 8
    catalyst = metrics["official_catalyst"].grade / 4
    total = 30 * fundamental + 25 * quality + 25 * timing + 10 * valuation + 10 * catalyst
    return ScoredCompany(symbol, name, sector, round(total, 2), owned, True, ("dated primary-source evidence",))

def select_top10(scored, incumbents, owned, max_per_sector=2, replacement_buffer=5.0):
    incumbent_by_sector = {item.sector: item for item in incumbents if item.eligible}
    ordered = sorted((item for item in scored if item.eligible), key=lambda item: (-item.total_score, item.symbol))
    selected, sectors = [], {}
    for item in ordered:
        incumbent = incumbent_by_sector.get(item.sector)
        if incumbent and incumbent.symbol != item.symbol and item.total_score < incumbent.total_score + replacement_buffer:
            continue
        if sectors.get(item.sector, 0) >= max_per_sector:
            continue
        selected.append(ScoredCompany(item.symbol, item.name, item.sector, item.total_score, item.symbol in owned or item.owned, item.eligible, item.reasons))
        sectors[item.sector] = sectors.get(item.sector, 0) + 1
        if len(selected) == 10:
            break
    for incumbent in incumbents:
        if len(selected) == 0 and incumbent.eligible:
            selected.append(incumbent)
    return selected
