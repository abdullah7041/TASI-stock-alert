"""Deterministic, in-memory research report boundary.

This module deliberately has no Firestore, OpenAI, trade, or ledger dependency.
Adapters for persistent storage and web research can implement its protocols later.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Protocol

from cockpit.research_contracts import (
    BudgetState,
    ReportSection,
    ResearchReport,
    ResearchRequest,
    ResearchVerdict,
    validate_estimated_cost_sar,
)

RESEARCH_CAP_SAR = 45.0


class SnapshotLookup(Protocol):
    def get(self, symbol: str) -> Mapping[str, object] | None: ...


class ReportCache(Protocol):
    def get(self, request: ResearchRequest) -> ResearchReport | None: ...

    def put(self, report: ResearchReport) -> None: ...


class BudgetReservations(Protocol):
    def reserve(self, cost_sar: float) -> bool: ...

    def state(self) -> BudgetState: ...


class BudgetCapExceeded(ValueError):
    """Raised before any new report work can exceed the 45-SAR cap."""


class InMemorySnapshotLookup:
    """A deterministic snapshot port used by unit tests and local previews."""

    def __init__(self, candidates: Mapping[str, Mapping[str, object]]):
        self._candidates = dict(candidates)

    def get(self, symbol: str) -> Mapping[str, object] | None:
        return self._candidates.get(symbol)


class InMemoryReportCache:
    """Cache reports by user, symbol, and Riyadh trading date."""

    def __init__(self) -> None:
        self._reports: dict[tuple[str, str, object], ResearchReport] = {}

    def get(self, request: ResearchRequest) -> ResearchReport | None:
        return self._reports.get(_cache_key(request))

    def put(self, report: ResearchReport) -> None:
        self._reports[(report.user_id, report.symbol, report.trading_date)] = report


class InMemoryBudgetReservations:
    """A 45-SAR reservation port with observable local state."""

    def __init__(self, reserved_sar: float = 0.0, cap_sar: float = 45.0) -> None:
        self._cap_sar = cap_sar
        self.reserved_sar = reserved_sar
        self.reservation_count = 0

    def reserve(self, cost_sar: float) -> bool:
        cost_sar = validate_estimated_cost_sar(cost_sar)
        if self.reserved_sar + cost_sar > self._cap_sar:
            return False
        self.reserved_sar += cost_sar
        self.reservation_count += 1
        return True

    def state(self) -> BudgetState:
        return BudgetState(cap_sar=self._cap_sar, reserved_sar=self.reserved_sar)


class ResearchService:
    def __init__(self, *, cache: ReportCache, budget: BudgetReservations) -> None:
        self._cache = cache
        self._budget = budget

    def start_report(
        self, request: ResearchRequest, snapshot: SnapshotLookup
    ) -> ResearchReport:
        cost_sar = validate_estimated_cost_sar(request.estimated_cost_sar)
        candidate = self._qualified_candidate(request.symbol, snapshot)
        cached = self._cache.get(request)
        if cached is not None:
            return cached

        state = self._budget.state()
        if (
            state.reserved_sar + cost_sar > RESEARCH_CAP_SAR
            or not self._budget.reserve(cost_sar)
        ):
            raise BudgetCapExceeded("Research budget would exceed the 45 SAR cap")

        report = ResearchReport(
            report_id=f"{request.user_id}:{request.symbol}:{request.trading_date.isoformat()}",
            user_id=request.user_id,
            symbol=request.symbol,
            trading_date=request.trading_date,
            verdict=ResearchVerdict.WAIT,
            data_status=_data_status(candidate),
            sections=_deterministic_sections(candidate),
        )
        self._cache.put(report)
        return report

    def compare(
        self, symbols: Sequence[str], snapshot: SnapshotLookup
    ) -> dict[str, tuple[ReportSection, ...]]:
        return {
            symbol: _deterministic_sections(self._qualified_candidate(symbol, snapshot))
            for symbol in symbols
        }

    @staticmethod
    def _qualified_candidate(
        symbol: str, snapshot: SnapshotLookup
    ) -> Mapping[str, object]:
        candidate = snapshot.get(symbol)
        if candidate is None or int(candidate.get("conditions_met", 0)) < 2:
            raise ValueError("Only symbols with conditions_met >= 2 can be researched")
        return candidate


def _cache_key(request: ResearchRequest) -> tuple[str, str, object]:
    return (request.user_id, request.symbol, request.trading_date)


def _data_status(candidate: Mapping[str, object]) -> str:
    return str(candidate.get("data_status", "preview-delayed"))


def _deterministic_sections(
    candidate: Mapping[str, object],
) -> tuple[ReportSection, ReportSection]:
    data_status = _data_status(candidate)
    price = _number(candidate.get("price"))
    entry = _number(candidate.get("entry"))
    stop = _number(candidate.get("stop"))
    targets = ", ".join(f"{_number(target):.2f}" for target in _targets(candidate))
    technical = ReportSection(
        title="Technical Setup",
        content=(
            f"Delayed data: {data_status}\n"
            f"Price: {price:.2f}\n"
            f"Conditions met: {int(candidate['conditions_met'])}"
        ),
    )
    entry_plan = ReportSection(
        title="Entry Plan",
        content=f"Entry: {entry:.2f}\nStop: {stop:.2f}\nTargets: {targets}",
    )
    return (technical, entry_plan)


def _number(value: object) -> float:
    return float(value) if value is not None else 0.0


def _targets(candidate: Mapping[str, object]) -> Sequence[object]:
    targets = candidate.get("targets", ())
    return targets if isinstance(targets, Sequence) and not isinstance(targets, str) else ()
