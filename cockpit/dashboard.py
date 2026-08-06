"""Translate existing recommendation dictionaries into a stable dashboard shape."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from .contracts import ActionCard, DashboardSnapshot, ScannerCard


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _reason_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, Iterable):
        return " ".join(str(part) for part in value if part is not None)
    return ""


def _is_urgent(action: str) -> bool:
    normalized = action.strip().upper()
    return bool(normalized) and not normalized.startswith(("HOLD", "WATCH"))


def build_dashboard_snapshot(
    recs: list[Mapping[str, Any]],
    candidates: list[Mapping[str, Any]],
    as_of: str,
) -> dict[str, object]:
    """Build a frontend-ready snapshot without changing engine decisions.

    Existing non-HOLD/WATCH recommendations remain deterministic urgent cards.
    Only scanner names meeting both current conditions enter Home; a single
    condition is visible only through the future research view.
    """
    urgent = tuple(
        ActionCard(
            code=str(rec.get("code", "")),
            name=str(rec.get("name") or rec.get("code", "Unknown symbol")),
            action=str(rec.get("action", "")).strip(),
            price=_as_float(rec.get("price")),
            reason=_reason_text(rec.get("reason")),
            pnl_pct=_as_float(rec.get("pnl_pct", rec.get("pnlPct"))),
        )
        for rec in recs
        if _is_urgent(str(rec.get("action", "")))
    )

    research_count = sum(_as_float(candidate.get("conditions_met")) == 1 for candidate in candidates)
    qualified = [
        ScannerCard(
            code=str(candidate.get("code", "")),
            name=str(candidate.get("name") or candidate.get("code", "Unknown symbol")),
            relative_strength_pct=_as_float(
                candidate.get("rel_strength", candidate.get("relativeStrengthPct"))
            ),
            squeeze=bool(candidate.get("squeeze_met", candidate.get("squeeze", False))),
        )
        for candidate in candidates
        if _as_float(candidate.get("conditions_met")) >= 2
    ]
    qualified.sort(key=lambda card: card.relative_strength_pct, reverse=True)

    return DashboardSnapshot(
        as_of=as_of,
        urgent=urgent,
        changed=(),
        qualified=tuple(qualified),
        research_count=research_count,
    ).to_dict()
