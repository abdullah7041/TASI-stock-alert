"""Read-only contracts for scanner-qualified research reports."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum
from math import isfinite


class ResearchVerdict(str, Enum):
    """The only verdicts a research report may communicate."""

    RESEARCH = "RESEARCH"
    WAIT = "WAIT"
    SKIP = "SKIP"


@dataclass(frozen=True)
class Citation:
    title: str
    url: str
    publisher: str | None = None


@dataclass(frozen=True)
class ReportSection:
    title: str
    content: str
    citations: tuple[Citation, ...] = ()


@dataclass(frozen=True)
class ResearchReport:
    report_id: str
    user_id: str
    symbol: str
    trading_date: date
    verdict: ResearchVerdict
    data_status: str
    sections: tuple[ReportSection, ...]
    citations: tuple[Citation, ...] = ()

    def __post_init__(self) -> None:
        try:
            verdict = ResearchVerdict(self.verdict)
        except (TypeError, ValueError) as error:
            raise ValueError("Research verdict must be RESEARCH, WAIT, or SKIP") from error
        object.__setattr__(self, "verdict", verdict)


@dataclass(frozen=True)
class BudgetState:
    cap_sar: float = 45.0
    reserved_sar: float = 0.0

    @property
    def remaining_sar(self) -> float:
        return max(0.0, self.cap_sar - self.reserved_sar)


@dataclass(frozen=True)
class ResearchRequest:
    user_id: str
    symbol: str
    trading_date: date
    estimated_cost_sar: float

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "estimated_cost_sar",
            validate_estimated_cost_sar(self.estimated_cost_sar),
        )


def validate_estimated_cost_sar(value: object) -> float:
    if isinstance(value, bool):
        raise ValueError("Estimated cost must be finite, non-negative SAR")
    try:
        cost_sar = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError("Estimated cost must be finite, non-negative SAR") from error
    if not isfinite(cost_sar) or cost_sar < 0:
        raise ValueError("Estimated cost must be finite, non-negative SAR")
    return cost_sar
