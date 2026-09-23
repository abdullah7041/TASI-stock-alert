"""Emit a dashboard artifact from the CURRENT producer code, offline.

The cockpit rejected every ingest with HTTP 400 while the committed
dashboard.json parsed cleanly -- because the committed file was written by
older code than the running producer. Checking the artifact in the repo
therefore proves nothing about the artifact the next run will send.

This builds one from today's code paths with synthetic records and no network,
so CI can hand it to the site's own parser. Producer and consumer disagreeing
becomes a failed build instead of a silent morning.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import artifacts  # noqa: E402
import main  # noqa: E402

RECORD = {
    "kind": "holding", "code": "1303", "name": "EIC", "price": 14.83,
    "priceDate": "2026-08-24",
    "action": "HOLD", "reason": ["above stop"], "unrealized_pct": 19.5,
    "short_term": {"momentum_pct": -1.3, "rsi": 50.1},
    "long_term": {"trend": "up", "momentum_pct": 8.4, "rsi": 52.3},
    "volume": {"ratio": 3.2, "window": 20, "unusual": True,
               "turnover_sar": 1_000_000.0, "median_sar": 300_000.0},
    "delta": {"price_pct": 1.2, "rsi_delta": 3.2, "rules_met_delta": 0,
              "flipped": [], "trend_flipped": False},
    "trend_streak": {"days": 14, "started": "2026-08-05"},
    "news": {"ok": True, "headlines": [], "label": "neutral", "score": 0.0},
    "verified": True,
    "rules": [
        {
            "rule": "stop_level",
            "available": True,
            "passed": False,
            "plain": "Protective stop not crossed.",
        }
    ],
}

CHART = {
    "code": "1303",
    "name": "EIC",
    "status": "available",
    "levels": {},
    "bars": [
        {
            "date": day,
            "Open": 14.7,
            "High": 15.0,
            "Low": 14.5,
            "Close": 14.83,
            "Volume": 1_000_000.0,
        }
        for day in (
            "2026-08-18",
            "2026-08-19",
            "2026-08-20",
            "2026-08-23",
            "2026-08-24",
        )
    ],
}

SCAN = {
    "candidates": [{"code": "4321", "price": 22.4, "conditions_met": 2,
                    "rel_strength": 31.4, "rel_strength_met": True,
                    "volatility_pct": 1.8, "atr_squeeze_pctile": 0.1,
                    "squeeze_met": True, "liquidity_sar": 900_000.0}],
    "names": {"4321": "Example Industrial"},
    "indexUnavailable": False,
    "warning": None,
}


def main_entry(destination: str) -> int:
    generated_at = "2026-08-25T05:30:00Z"
    snapshot = main._dashboard_snapshot(
        "neutral", [RECORD], {"monthly_cap": 500.0, "budget": 500.0, "allocated": 0.0},
        SCAN,
        top10={"proposalId": "top10-2026-08-25-sample", "status": "draft",
               "researchedAt": generated_at, "entries": []},
        as_of=generated_at,
        scheduled_for=generated_at,
    )
    artifact = artifacts.build_digest_artifact(
        snapshot, recs=[RECORD],
        lean_status={"ok": False, "provider": "openrouter",
                     "reason": "no OPENROUTER_API_KEY configured"},
        charts=[CHART], scheduled_for=generated_at)
    Path(destination).write_text(
        json.dumps(artifact, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {destination} (schemaVersion {artifact['schemaVersion']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_entry(sys.argv[1] if len(sys.argv) > 1 else "sample-dashboard.json"))
