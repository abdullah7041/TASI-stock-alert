from __future__ import annotations

from datetime import date
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cockpit.research_contracts import ResearchRequest, ResearchVerdict
from cockpit.research_service import (
    BudgetCapExceeded,
    InMemoryBudgetReservations,
    InMemoryReportCache,
    InMemorySnapshotLookup,
    ResearchService,
)


def qualified_snapshot() -> InMemorySnapshotLookup:
    return InMemorySnapshotLookup(
        {
            "2222": {
                "symbol": "2222",
                "name": "Saudi Cable",
                "conditions_met": 2,
                "price": 102.5,
                "entry": 103.0,
                "stop": 98.0,
                "targets": [107.0, 112.0],
                "data_status": "preview-delayed",
            },
            "9999": {
                "symbol": "9999",
                "name": "Withheld Candidate",
                "conditions_met": 1,
                "price": 12.0,
                "data_status": "preview-delayed",
            },
        }
    )


def request(symbol: str = "2222") -> ResearchRequest:
    return ResearchRequest(
        user_id="owner-1",
        symbol=symbol,
        trading_date=date(2026, 8, 7),
        estimated_cost_sar=5.0,
    )


def test_start_report_rejects_a_symbol_with_fewer_than_two_conditions():
    service = ResearchService(
        cache=InMemoryReportCache(), budget=InMemoryBudgetReservations()
    )

    with pytest.raises(ValueError, match="conditions_met >= 2"):
        service.start_report(request("9999"), qualified_snapshot())


def test_start_report_emits_delayed_deterministic_sections_before_research():
    service = ResearchService(
        cache=InMemoryReportCache(), budget=InMemoryBudgetReservations()
    )

    report = service.start_report(request(), qualified_snapshot())

    assert report.verdict is ResearchVerdict.WAIT
    assert report.data_status == "preview-delayed"
    assert [section.title for section in report.sections] == [
        "Technical Setup",
        "Entry Plan",
    ]
    assert "Delayed data: preview-delayed" in report.sections[0].content
    assert "Entry: 103.00" in report.sections[1].content
    assert report.citations == ()


def test_start_report_reuses_same_date_cache_without_another_reservation():
    cache = InMemoryReportCache()
    budget = InMemoryBudgetReservations()
    service = ResearchService(cache=cache, budget=budget)

    first = service.start_report(request(), qualified_snapshot())
    second = service.start_report(request(), qualified_snapshot())

    assert second is first
    assert budget.reserved_sar == 5.0
    assert budget.reservation_count == 1


def test_start_report_stops_when_the_45_sar_cap_would_be_exceeded():
    budget = InMemoryBudgetReservations(reserved_sar=41.0)
    service = ResearchService(cache=InMemoryReportCache(), budget=budget)

    with pytest.raises(BudgetCapExceeded, match="45 SAR"):
        service.start_report(request(), qualified_snapshot())

    assert budget.reserved_sar == 41.0
    assert budget.reservation_count == 0


def test_start_report_enforces_the_45_sar_cap_even_if_a_port_allows_more():
    budget = InMemoryBudgetReservations(reserved_sar=41.0, cap_sar=50.0)
    service = ResearchService(cache=InMemoryReportCache(), budget=budget)

    with pytest.raises(BudgetCapExceeded, match="45 SAR"):
        service.start_report(request(), qualified_snapshot())

    assert budget.reserved_sar == 41.0
    assert budget.reservation_count == 0


def test_compare_rejects_unqualified_symbols_without_creating_a_report():
    service = ResearchService(
        cache=InMemoryReportCache(), budget=InMemoryBudgetReservations()
    )

    with pytest.raises(ValueError, match="conditions_met >= 2"):
        service.compare(["2222", "9999"], qualified_snapshot())


def test_compare_returns_only_deterministic_sections_without_a_reservation():
    budget = InMemoryBudgetReservations()
    service = ResearchService(cache=InMemoryReportCache(), budget=budget)

    comparison = service.compare(["2222"], qualified_snapshot())

    assert list(comparison) == ["2222"]
    assert [section.title for section in comparison["2222"]] == [
        "Technical Setup",
        "Entry Plan",
    ]
    assert budget.reservation_count == 0
