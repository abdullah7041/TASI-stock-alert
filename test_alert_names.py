"""Company names and Discord wording are a contract, not an implementation detail.

These tests are offline on purpose: they must fail on a wording or field change
even when no network, Discord webhook, or market data source is reachable.
"""
from __future__ import annotations

import pytest

import main
import notify as nt
from movement import UnnamedAlertError, detect_unusual_movement

FRESH_OBSERVATION = {
    "code": "4164",
    "name": "Nahdi Medical",
    "excess_move_pct": 2.4,
    "robust_z": 4.6,
    "volume_ratio": 2.5,
    "observed_at": "2026-08-19T10:20:00Z",
    "received_at": "2026-08-19T10:35:00Z",
    "fresh": True,
    "comparable_observations": 30,
}


def test_new_alert_carries_the_company_name_from_the_recommendation():
    alert = detect_unusual_movement(FRESH_OBSERVATION, {}, [])["alert"]

    assert alert["name"] == "Nahdi Medical"
    assert alert["code"] == "4164"


def test_new_alert_without_a_company_name_is_rejected():
    unnamed = {key: value for key, value in FRESH_OBSERVATION.items() if key != "name"}

    with pytest.raises(UnnamedAlertError):
        detect_unusual_movement(unnamed, {}, [])


def test_blank_company_name_is_rejected_rather_than_falling_back_to_the_code():
    with pytest.raises(UnnamedAlertError):
        detect_unusual_movement({**FRESH_OBSERVATION, "name": "   "}, {}, [])


def test_movement_alerts_resolve_names_from_the_verified_catalog(monkeypatch):
    monkeypatch.setattr(main, "_load", lambda path, default: {"4164": {"config_name": "Nahdi Medical", "verified": True}} if path == main.SYMBOLS_FILE else default)

    assert main._verified_name("4164") == "Nahdi Medical"
    assert main._verified_name("9999") == ""


def test_unverified_catalog_entries_do_not_supply_a_name(monkeypatch):
    monkeypatch.setattr(main, "_load", lambda path, default: {"4164": {"config_name": "Nahdi Medical", "verified": False}} if path == main.SYMBOLS_FILE else default)

    assert main._verified_name("4164") == ""


def test_movement_alert_discord_format_is_frozen():
    alert = {
        "alertId": "golden",
        "code": "4164",
        "name": "Nahdi Medical",
        "direction": "upside",
        "observedAt": "2026-08-19T10:20:00Z",
        "receivedAt": "2026-08-19T10:35:00Z",
        "latency": "delayed-intraday",
        "excessMovePct": 2.4,
        "robustZ": 4.6,
        "volumeRatio": 2.5,
        "reason": "Delayed bot confirmation of statistically unusual price movement. Volume confirms participation.",
    }

    assert nt.build_movement_alert_message([alert], "2026-08-19T10:35:00Z") == "\n".join([
        "__**TASI unusual movement (2026-08-19T10:35:00Z)**__",
        "_Delayed analysis; verify live pricing in your broker app._",
        "**Nahdi Medical (4164) — upside**",
        "- Delayed bot confirmation of statistically unusual price movement. Volume confirms participation.",
        "- Observed 2026-08-19T10:20:00Z; received 2026-08-19T10:35:00Z.",
        "Broker app owns real-time price alerts; this bot never places an order.",
    ])


def test_second_company_renders_name_then_code_too():
    alert = {
        "code": "6017",
        "name": "Jahez",
        "direction": "downside",
        "observedAt": "2026-08-19T11:00:00Z",
        "receivedAt": "2026-08-19T11:15:00Z",
        "reason": "Delayed bot confirmation of statistically unusual price movement.",
    }

    assert "**Jahez (6017) — downside**" in nt.build_movement_alert_message([alert], "2026-08-19T11:15:00Z")


def test_stored_legacy_alert_says_the_name_is_unavailable_instead_of_reusing_the_code():
    legacy = {
        "code": "1303",
        "direction": "upside",
        "observedAt": "2026-08-12T10:00:00Z",
        "receivedAt": "2026-08-12T10:01:00Z",
        "reason": "Delayed bot confirmation.",
    }

    message = nt.build_movement_alert_message([legacy], "2026-08-12T10:01:00Z")
    assert "**Company name unavailable (1303) — upside**" in message
    assert "**1303 upside**" not in message


def test_daily_digest_discord_format_is_frozen():
    snapshot = {
        "tradeDate": "2026-08-19",
        "summaryV1": {
            "version": 1,
            "generatedAt": "2026-08-19T06:40:00Z",
            "scheduledFor": "2026-08-19T06:40:00Z",
            "latenessMinutes": 3,
            "cards": [
                {"kind": "portfolio", "state": "quiet", "text": "No holding crossed a decision level."},
                {"kind": "top10", "state": "pending", "text": "Top 10: evidence pending; no current primary-source review."},
            ],
        },
    }

    assert nt.build_dashboard_digest(snapshot) == "\n".join([
        "__**TASI delayed digest (2026-08-19)**__",
        "- No holding crossed a decision level.",
        "- Top 10: evidence pending; no current primary-source review.",
        "- Digest started 3 minutes after its scheduled time.",
    ])


def test_discord_smoke_never_collects_market_data_or_writes_state(monkeypatch):
    sent = []
    monkeypatch.setattr(main.nt, "send_discord", lambda content: sent.append(content) or True)
    monkeypatch.setattr(main, "_collect_recs", lambda **_: (_ for _ in ()).throw(AssertionError("smoke must not collect market data")))
    monkeypatch.setattr(main, "_movement_alerts", lambda *_: (_ for _ in ()).throw(AssertionError("smoke must not detect movement")))
    monkeypatch.setattr(main, "_save", lambda *_: (_ for _ in ()).throw(AssertionError("smoke must not write state")))

    assert main.mode_discord_smoke() == 0
    assert len(sent) == 1
    assert sent[0].startswith("__**DISCORD SMOKE TEST — SYNTHETIC ALERT, NOT A REAL SIGNAL**__")
    assert "Synthetic Smoke Test Company (0000) — upside" in sent[0]


def test_discord_smoke_reports_failure_so_the_workflow_fails(monkeypatch):
    monkeypatch.setattr(main.nt, "send_discord", lambda _content: False)

    assert main.mode_discord_smoke() == 1
