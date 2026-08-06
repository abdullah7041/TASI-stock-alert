from cockpit.dashboard import build_dashboard_snapshot


def test_dashboard_snapshot_hides_one_condition_scanner_candidates_from_home():
    snapshot = build_dashboard_snapshot(
        recs=[
            {
                "code": "2320",
                "name": "Al-Babtain",
                "action": "SELL (STOP)",
                "price": 55.7,
                "reason": ["stop breached"],
            }
        ],
        candidates=[
            {"code": "6040", "conditions_met": 1, "rel_strength": 60.7},
            {"code": "9999", "conditions_met": 2, "rel_strength": 20.0},
        ],
        as_of="2026-08-03T09:40:00+03:00",
    )

    assert [card["code"] for card in snapshot["urgent"]] == ["2320"]
    assert [card["code"] for card in snapshot["qualified"]] == ["9999"]
    assert snapshot["researchCount"] == 1


def test_dashboard_snapshot_ignores_hold_and_watch_recommendations():
    snapshot = build_dashboard_snapshot(
        recs=[
            {"code": "1000", "action": "HOLD", "price": 10.0},
            {"code": "1001", "action": "WATCH", "price": 11.0},
        ],
        candidates=[],
        as_of="2026-08-03T09:40:00+03:00",
    )

    assert snapshot["urgent"] == []
