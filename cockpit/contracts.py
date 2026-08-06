"""Typed contracts shared by the deterministic engine and Action Cockpit."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ActionCard:
    code: str
    name: str
    action: str
    price: float
    reason: str
    pnl_pct: float

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "name": self.name,
            "action": self.action,
            "price": self.price,
            "reason": self.reason,
            "pnlPct": self.pnl_pct,
        }


@dataclass(frozen=True)
class ScannerCard:
    code: str
    name: str
    relative_strength_pct: float
    squeeze: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "name": self.name,
            "relativeStrengthPct": self.relative_strength_pct,
            "squeeze": self.squeeze,
        }


@dataclass(frozen=True)
class DashboardSnapshot:
    as_of: str
    urgent: tuple[ActionCard, ...]
    changed: tuple[dict[str, str], ...]
    qualified: tuple[ScannerCard, ...]
    research_count: int
    data_status: str = "preview-delayed"

    def to_dict(self) -> dict[str, object]:
        return {
            "asOf": self.as_of,
            "dataStatus": self.data_status,
            "urgent": [card.to_dict() for card in self.urgent],
            "changed": list(self.changed),
            "qualified": [card.to_dict() for card in self.qualified],
            "researchCount": self.research_count,
        }
