"""
Orchestration + CLI modes.

Modes (set via env MODE or first CLI arg):
  heartbeat  - send one "alive" ping to Discord. Tests secrets + webhook.
  suggest    - print raw price/RSI/support/resistance for every name. No alerts.
  autolevels - derive buy zones / stops / targets into levels.json. You review it.
  digest     - one pre-open summary of holdings + watchlist, plus a breakout
               scanner section over the broader Tadawul universe, sent to
               Discord.
  run        - the session job: check levels, send alerts on hits, dedup.

Validation modes (local only, slow, never on the schedule):
  universe   - probe Tadawul code blocks -> universe.json (~30 min, once).
  features   - walk-forward indicators over that universe -> .cache/features.csv.
  backtest   - replay BUY decisions and score them. SWEEP=1 for a threshold grid.

Run locally:  MODE=suggest python main.py
On GitHub Actions the workflow sets MODE.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from datetime import date
from pathlib import Path

import config as cfg
import data as dat
import analyze as az
import notify as nt
import indicators as ind
import history as histmod
import disclosures as discl
from movement import detect_unusual_movement
from research.company_evidence import load_evidence_records
from research.entry_forecast import unavailable_forecast
from research.top10 import score_company, select_top10
from research import official_sources
from summary_contract import build_summary_v1, summary_lines

HERE = Path(__file__).parent
SYMBOLS_FILE = HERE / "symbols.json"
LEVELS_FILE = HERE / "levels.json"
STATE_FILE = HERE / "state.json"
BUDGET_FILE = HERE / "budget_state.json"
HISTORY_FILE = HERE / "history.json"
DASHBOARD_FILE = HERE / "dashboard.json"
TOP10_FILE = HERE / "top10_draft.json"
MOVEMENT_STATE_FILE = HERE / "movement_state.json"
ALERTS_FILE = HERE / "movement_alerts.json"
EVIDENCE_FILE = HERE / "research" / "evidence.json"
FORECAST_METRICS_FILE = HERE / "research" / "forecast_metrics.json"
EVIDENCE_QUEUE_FILE = HERE / "research" / "evidence_queue.json"


# --- small JSON helpers ----------------------------------------------------
def _load(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default
    return default


def _save(path: Path, obj):
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


def _today() -> str:
    return time.strftime("%Y-%m-%d")


# --- data assembly ---------------------------------------------------------
def _load_history(code: str) -> "any":
    return dat.get_history(code, cfg.TECH["history_period"])


def _levels_for(code: str, stored: dict | None = None) -> dict:
    if stored is None:  # fallback path; callers in a loop pass the loaded dict.
        stored = _load(LEVELS_FILE, {})
    if code in stored:
        return stored[code]
    return cfg.FALLBACK_LEVELS.get(code, {})


# --- monthly budget ledger --------------------------------------------------
def _month_key() -> str:
    return time.strftime("%Y-%m")


def _budget_remaining() -> float:
    """Monthly cap minus what has already been RECOMMENDED this calendar month.
    Edit budget_state.json by hand if you skipped a recommended buy."""
    state = _load(BUDGET_FILE, {})
    spent = float(state.get(_month_key(), {}).get("spent", 0.0))
    return max(0.0, cfg.BUDGET["monthly_budget_sar"] - spent)


# --- symbol verification ----------------------------------------------------
def _verify_symbols(items: list) -> dict:
    """Map code -> {verified, yahoo_name, reason}. Catches wrong config codes
    (e.g. 6015 labeled 'Jahez' is really Americana Restaurants).

    A code the user has confirmed in symbols.json (verified:true for the same
    config name) is trusted without a network call — this is how brand-vs-legal
    names are whitelisted (Avalon Pharma == 'Middle East Pharmaceutical
    Industries'). Everything else is checked against Yahoo's company name and
    the result cached back to symbols.json.
    """
    store = _load(SYMBOLS_FILE, {})
    result, changed = {}, False
    for it in items:
        code, name = it["code"], it["name"]
        entry = store.get(code)
        if entry and entry.get("verified") and entry.get("config_name") == name:
            result[code] = {"verified": True, "yahoo_name": entry.get("yahoo_name", ""),
                            "reason": entry.get("reason", "confirmed in symbols.json")}
            continue
        yn = dat._yahoo_name(code)
        ok, reason = dat.verify_symbol(name, yn)
        store[code] = {"config_name": name, "yahoo_name": yn, "verified": ok,
                       "reason": reason, "checked": _today()}
        result[code] = {"verified": ok, "yahoo_name": yn, "reason": reason}
        changed = True
    if changed:
        _save(SYMBOLS_FILE, store)
    return result


def _snapshot_for(rec: dict) -> dict:
    lt = rec.get("long_term", {})
    blocking = None
    rules_met = None
    if rec["kind"] == "watchlist":
        rules_met = rec.get("rules_met")
        blocking = sorted(r["rule"] for r in rec.get("rules", []) if not r["passed"])
    return {"price": rec["price"], "rsi": lt.get("rsi"), "trend": lt.get("trend"),
            "rules_met": rules_met, "blocking": blocking}


def _budget_record(buys: list) -> None:
    """Append this run's sized BUY recommendations to the month's ledger."""
    sized = [b for b in buys if b.get("sizing") and b["sizing"].get("shares", 0) > 0]
    if not sized:
        return
    state = _load(BUDGET_FILE, {})
    month = state.setdefault(_month_key(), {"spent": 0.0, "allocations": []})
    for b in sized:
        month["allocations"].append({
            "date": _today(), "code": b["code"], "name": b["name"],
            "shares": b["sizing"]["shares"], "spend": b["sizing"]["spend"],
        })
        month["spent"] = round(month["spent"] + b["sizing"]["spend"], 2)
    _save(BUDGET_FILE, state)


def _unavailable_top10(generated_at: str) -> dict:
    return {"proposalId": f"top10-{generated_at[:10]}-evidence-pending", "status": "draft", "researchedAt": generated_at, "entries": []}


def _evidence_top10(scanner_result: dict | None, recs: list, generated_at: str) -> dict | None:
    """Build a draft only from dated, local primary-source reviews; never fill it from price data alone."""
    raw_records = _load(EVIDENCE_FILE, [])
    if not raw_records:
        return None
    try:
        records = load_evidence_records(raw_records, date.fromisoformat(generated_at[:10]))
    except (TypeError, ValueError) as exc:
        print(f"Top 10 evidence unavailable: {exc}")
        return None
    candidates = {item.get("code"): item for item in (scanner_result or {}).get("candidates", [])}
    reads = {item.get("code"): item for item in recs}
    owned = {item["code"] for item in cfg.HOLDINGS}
    scored = []
    for symbol, evidence in records.items():
        candidate = candidates.get(symbol, {})
        read = reads.get(symbol, {})
        scored.append(score_company(symbol, evidence.company_name, evidence.sector, symbol in owned, evidence,
                                    float(candidate.get("rel_strength") or 0.0),
                                    read.get("long_term", {}).get("trend") == "up", 2.0))
    chosen = select_top10(scored, [], owned)
    if not chosen:
        return None
    entries = []
    for item in chosen:
        evidence = records[item.symbol]
        entries.append({"code": item.symbol, "name": item.name, "sector": item.sector, "owned": item.owned,
                        "totalScore": item.total_score, "reasons": list(item.reasons),
                        "evidence": {"source": evidence.source_name, "observedAt": evidence.published_at,
                                     "receivedAt": evidence.retrieved_at, "latency": "official-filing",
                                     "freshness": "current", "url": evidence.source_url}})
    return {"proposalId": f"top10-{generated_at[:10]}-evidence", "status": "draft", "researchedAt": generated_at, "entries": entries}


def _forecast(generated_at: str) -> dict:
    metrics = _load(FORECAST_METRICS_FILE, {})
    return unavailable_forecast(generated_at[:10], metrics, bool(metrics.get("survivorship_limited", True)))


def _dashboard_snapshot(regime: str, recs: list, budget: dict, scanner_result: dict | None, *, as_of: str | None = None, top10: dict | None = None, alerts: list | None = None, scheduled_for: str | None = None) -> dict:
    """Serialize one delayed daily digest for the private cockpit."""
    generated_at = as_of or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    urgent = []
    unknown_cost = []
    for r in recs:
        if r.get("kind") != "holding" or r.get("action") in ("HOLD", "WATCH"):
            continue
        # `unrealized_pct` is None whenever config.py gives this holding no
        # usable avg_cost (missing, 0, or 0.0). The snapshot contract requires a
        # finite number, so send 0.0 -- but never let that read as "flat": an
        # unknown cost basis is a data-quality problem, not a 0% return, and it
        # goes in warnings the same way a failed scanner run does.
        pnl = r.get("unrealized_pct")
        if pnl is None:
            unknown_cost.append(str(r.get("code", "?")))
            pnl = 0.0
        urgent.append({
            "code": r["code"], "name": r["name"], "action": r["action"], "price": r["price"],
            "reason": (r.get("reason") or ["No reason recorded."])[0],
            "pnlPct": float(pnl),
        })
    candidates = (scanner_result or {}).get("candidates", [])
    names = (scanner_result or {}).get("names", {})
    qualified = [
        {"code": c["code"], "name": names.get(c["code"], c["code"]), "relativeStrengthPct": round(float(c.get("rel_strength") or 0.0), 1), "squeeze": bool(c.get("squeeze_met")), "conditionsMet": 2}
        for c in candidates if c.get("conditions_met") == 2
    ]
    warning = (scanner_result or {}).get("warning")
    warnings = [warning] if warning else []
    if unknown_cost:
        warnings.append(
            f"No avg_cost in config.py for {', '.join(sorted(unknown_cost))} — "
            f"P/L shown as 0.0% is unknown, not flat."
        )
    top10 = top10 if top10 is not None else _load(TOP10_FILE, _unavailable_top10(generated_at))
    if not top10.get("entries"):
        warnings.append("Top 10 draft unavailable: no current primary-source evidence has been reviewed yet.")
    holdings = [
        {"code": item["code"], "name": item["name"], "shares": int(item["shares"]), "avgCostSar": float(item["avg_cost"])}
        for item in cfg.HOLDINGS
    ]
    snapshot = {"schemaVersion": 2, "tradeDate": generated_at[:10], "asOf": generated_at,
                "regime": regime, "dataStatus": "delayed-daily", "warnings": warnings,
                "urgent": urgent, "changed": [], "qualified": qualified,
                "researchCount": len([c for c in candidates if c.get("conditions_met") == 1]),
                "monthlyBudgetSar": budget.get("monthly_cap"), "top10": top10,
                "portfolio": {"confirmedAt": generated_at, "cashSar": 0.0, "contributionMonth": None, "holdings": holdings, "proposal": None},
                "alerts": alerts or [], "forecast": _forecast(generated_at)}
    snapshot["summaryV1"] = build_summary_v1(snapshot, scheduled_for=scheduled_for)
    snapshot["summary"] = summary_lines(snapshot["summaryV1"])
    return snapshot


# --- modes -----------------------------------------------------------------
def mode_heartbeat() -> int:
    ok = nt.send_discord("TASI recommender is alive and watching. (heartbeat, no prices checked)")
    print("heartbeat sent:", ok)
    return 0 if ok else 1


# A fixed, obviously-synthetic company. Using a real watchlist name here would
# make the smoke message indistinguishable from a genuine movement alert.
SMOKE_ALERT = {
    "alertId": "discord-smoke",
    "code": "0000",
    "name": "Synthetic Smoke Test Company",
    "direction": "upside",
    "latency": "delayed-intraday",
    "excessMovePct": 2.5,
    "robustZ": 4.5,
    "volumeRatio": 3.0,
    "reason": "SYNTHETIC SMOKE TEST. No market data was collected and no state was written.",
}


def mode_discord_smoke() -> int:
    """Prove real Discord delivery through the real formatter, touching nothing else.

    This deliberately reuses build_movement_alert_message instead of a private
    string: a smoke test that renders its own format cannot detect drift in the
    format production actually sends.
    """
    as_of = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    alert = {**SMOKE_ALERT, "observedAt": as_of, "receivedAt": as_of}
    message = (
        "__**DISCORD SMOKE TEST — SYNTHETIC ALERT, NOT A REAL SIGNAL**__\n"
        + nt.build_movement_alert_message([alert], as_of)
    )
    ok = nt.send_discord(message)
    print("discord smoke sent:", ok)
    return 0 if ok else 1


def mode_suggest() -> int:
    dat.get_histories([x["code"] for x in cfg.HOLDINGS + cfg.WATCHLIST],
                      cfg.TECH["history_period"])  # one batch; loop reads cache.
    for item in cfg.HOLDINGS + cfg.WATCHLIST:
        code = item["code"]
        df = _load_history(code)
        if df.empty:
            print(f"{code} {item['name']}: NO DATA")
            continue
        price = float(df["Close"].iloc[-1])
        r = ind.rsi(df["Close"], cfg.TECH["rsi_period"])
        sup, res = ind.support_resistance(df["High"], df["Low"], df["Close"], cfg.TECH["sr_lookback"])
        print(f"{code} {item['name']:<16} px {price:>8.2f}  RSI {r:>5.1f}  "
              f"sup {sup}  res {res}  bars {len(df)}")
    return 0


def mode_autolevels() -> int:
    out = _load(LEVELS_FILE, {})
    dat.get_histories([x["code"] for x in cfg.HOLDINGS + cfg.WATCHLIST],
                      cfg.TECH["history_period"])  # one batch; loop reads cache.
    for item in cfg.HOLDINGS + cfg.WATCHLIST:
        code = item["code"]
        df = _load_history(code)
        if df.empty or len(df) < cfg.TECH["min_history_bars"]:
            print(f"{code} {item['name']}: skipped (insufficient history)")
            continue
        lv = az.derive_levels(df, cfg.TECH, cfg.RISK["stop_loss_pct"], cfg.LEVELS)
        out[code] = {**out.get(code, {}), **lv}
        print(f"{code} {item['name']}: {lv}")
    _save(LEVELS_FILE, out)
    print(f"\nWrote {LEVELS_FILE.name}. Review it, adjust any number, then run normally.")
    return 0


def _collect_recs(include_news: bool, record_history: bool = False):
    """Returns (regime, recs, budget_summary).

    Speed: one batched Yahoo download for every name PLUS the index (was 14
    serial HTTP calls), news fetched in parallel threads (was 20 serial RSS
    requests), levels.json loaded once (was once per name).
    """
    index_code = cfg.REGIME["index_code"]
    all_codes = [x["code"] for x in cfg.HOLDINGS + cfg.WATCHLIST] + [index_code]
    hist = dat.get_histories(all_codes, cfg.TECH["history_period"])

    idx = hist.get(index_code)
    if idx is None or idx.empty:
        idx = dat.get_index_history(index_code)  # SAHMK fallback path.
    regime = az.market_regime(idx, cfg.REGIME["index_ma"])

    stored_levels = _load(LEVELS_FILE, {})
    verify = _verify_symbols(cfg.HOLDINGS + cfg.WATCHLIST)

    news_by_code = {}
    if include_news:
        from concurrent.futures import ThreadPoolExecutor
        import news as newsmod

        def _fetch(w):
            try:
                return w["code"], newsmod.get_news(w["name"], w["code"])
            except Exception:
                return w["code"], newsmod.NewsResult(query="", ok=False)

        with ThreadPoolExecutor(max_workers=8) as ex:
            news_by_code = dict(ex.map(_fetch, cfg.HOLDINGS + cfg.WATCHLIST))

        for code, result in news_by_code.items():
            newsmod.archive_headlines(code, result)

    all_disclosures, disclosures_ok = discl.fetch_all()

    unverified = []
    recs = []
    for h in cfg.HOLDINGS:
        df = hist.get(h["code"])
        if df is None or df.empty:
            continue
        price = float(df["Close"].iloc[-1])
        disc = discl.match_company(all_disclosures, disclosures_ok, discl.aliases_for(h))
        rec = az.evaluate_holding(h, price, df, _levels_for(h["code"], stored_levels),
                                  cfg.HORIZON, cfg.TECH, news_by_code.get(h["code"]), disc)
        v = verify.get(h["code"], {})
        rec["verified"], rec["yahoo_name"] = v.get("verified", True), v.get("yahoo_name", "")
        if not rec["verified"]:
            rec["reason"].insert(0, f"symbol UNVERIFIED: {v.get('reason')} — P/L may be wrong")
            unverified.append((h["code"], h["name"], v.get("yahoo_name", "")))
        recs.append(rec)
    for w in cfg.WATCHLIST:
        df = hist.get(w["code"])
        if df is None or df.empty:
            continue
        price = float(df["Close"].iloc[-1])
        disc = discl.match_company(all_disclosures, disclosures_ok, discl.aliases_for(w))
        rec = az.evaluate_watchlist(w, price, df, _levels_for(w["code"], stored_levels),
                                    cfg.HORIZON, cfg.TECH,
                                    news_by_code.get(w["code"]), cfg.BUY_CRITERIA, disc)
        v = verify.get(w["code"], {})
        rec["verified"], rec["yahoo_name"] = v.get("verified", True), v.get("yahoo_name", "")
        if not rec["verified"]:
            # Unverified names cannot become BUY; excluded from the budget too.
            rec["action"] = "WATCH (UNVERIFIED)"
            rec["reason"] = [f"symbol UNVERIFIED: {v.get('reason')} — fix the code in config.py"]
            unverified.append((w["code"], w["name"], v.get("yahoo_name", "")))
        recs.append(rec)

    if record_history:
        snapshot_history = _load(HISTORY_FILE, {})
        today = _today()
        for rec in recs:
            snap = _snapshot_for(rec)
            rec["delta"] = histmod.compute_delta(snapshot_history, rec["code"], today, snap)
            rec["trend_streak"] = histmod.compute_streak(snapshot_history, rec["code"], today,
                                                          "trend", snap["trend"])
            snapshot_history = histmod.record_snapshot(snapshot_history, rec["code"], today, snap)
        _save(HISTORY_FILE, snapshot_history)

    # Pool all BUYs (verified only — unverified were re-tagged above) and size
    # them from what is left of this month's budget.
    buys = [r for r in recs if r["action"] == "BUY"]
    budget_summary = az.allocate_budget(buys, _budget_remaining(),
                                        current_positions=len(cfg.HOLDINGS),
                                        max_positions=cfg.RISK["max_positions"])
    budget_summary["monthly_cap"] = cfg.BUDGET["monthly_budget_sar"]
    budget_summary["unverified"] = unverified
    _budget_record(buys)
    return regime, recs, budget_summary


def _scanner_result() -> dict:
    """Breakout scanner section for the digest. Fail-soft: this rides a
    genuinely new network-heavy step (~265 live Yahoo fetches) on every
    digest run, so ANY exception here (network failure, missing/empty
    universe.json, bad data, anything) must degrade to an 'unavailable'
    line rather than take down the holdings/watchlist digest that already
    worked before this step existed.
    """
    try:
        import universe
        import data
        import scanner

        codes = universe.load()
        if not codes:
            print("scanner: universe.json missing/empty — skipping scanner section.")
            return {"candidates": [], "names": {}, "indexUnavailable": False,
                    "warning": "scanner unavailable: universe.json missing"}

        index_code = cfg.REGIME["index_code"]
        hist = data.get_histories_adjusted(codes + [index_code], cfg.SCANNER["history_period"])
        index_df = hist.get(index_code)
        index_unavailable = index_df is None or index_df.empty
        if index_unavailable:
            print(f"scanner: no data for the index ({index_code}) this run -- "
                  f"rel_strength cannot be computed, so only the squeeze "
                  f"condition can fire for any candidate below.")

        candidates = scanner.scan(codes, hist, index_df)
        names = scanner.resolve_names(candidates)
        return {"candidates": candidates, "names": names, "indexUnavailable": index_unavailable,
                "warning": "TASI index unavailable; relative strength could not be calculated." if index_unavailable else None}
    except Exception as e:
        print(f"scanner: unavailable ({type(e).__name__}: {e})")
        return {"candidates": [], "names": {}, "indexUnavailable": False,
                "warning": f"scanner unavailable: {type(e).__name__}"}


def _scanner_block(result: dict | None = None) -> str:
    """Format a previously collected scanner result without rerunning it."""
    result = result or _scanner_result()
    if str(result.get("warning") or "").startswith("scanner unavailable:"):
        return "**Scanner**: unavailable (error during scan — see logs)"
    return nt.format_scanner_block(result["candidates"], result["names"],
                                   index_unavailable=result["indexUnavailable"])


def mode_digest() -> int:
    regime, recs, budget = _collect_recs(include_news=True, record_history=True)
    scanner_result = _scanner_result()
    snapshot = _dashboard_snapshot(
        regime, recs, budget, scanner_result,
        top10=_load(TOP10_FILE, _unavailable_top10(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))),
        scheduled_for=os.environ.get("SCHEDULED_FOR"),
    )
    _save(DASHBOARD_FILE, snapshot)
    msg = nt.build_dashboard_digest(snapshot)
    ok = nt.send_discord(msg)
    if not ok:
        print(msg)  # no webhook configured (e.g. local run) — show the digest here.
    print("digest sent:", ok, "| recs:", len(recs))
    return 0 if ok else 1


def mode_research_evidence() -> int:
    """Collect official announcement links into a human-review queue only."""
    import requests

    retrieved_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        announcements = official_sources.collect_official_announcements(
            requests.Session(), retrieved_at, lookback_days=7
        )
    except Exception as exc:
        print(f"official evidence collection unavailable: {exc}")
        return 1
    official_sources.write_review_queue(EVIDENCE_QUEUE_FILE, announcements, retrieved_at)
    print(f"official evidence review queue written: {len(announcements)} candidates; no Top 10 was changed.")
    return 0


def mode_top10_draft() -> int:
    """Create a dated draft snapshot; user approval remains required on the site."""
    regime, recs, budget = _collect_recs(include_news=True, record_history=False)
    scanner_result = _scanner_result()
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    draft = _evidence_top10(scanner_result, recs, generated_at) or _unavailable_top10(generated_at)
    _save(TOP10_FILE, draft)
    _save(DASHBOARD_FILE, _dashboard_snapshot(regime, recs, budget, scanner_result, as_of=generated_at, top10=draft))
    print("Top 10 evidence draft snapshot written; no list was approved or traded.")
    return 0


def mode_cockpit_refresh() -> int:
    """Generate a safe dashboard payload without Discord, broker, or state-changing trade actions."""
    regime, recs, budget = _collect_recs(include_news=True, record_history=False)
    scanner_result = _scanner_result()
    _save(DASHBOARD_FILE, _dashboard_snapshot(regime, recs, budget, scanner_result))
    print("cockpit refresh written; no Discord message or order was sent.")
    return 0


def _verified_name(code: str | None) -> str:
    """Resolve a company name from the verified symbol catalog, never from the code."""
    entry = _load(SYMBOLS_FILE, {}).get(str(code or ""), {})
    return str(entry.get("config_name") or "").strip() if entry.get("verified") else ""


def _movement_alerts(recs: list, received_at: str | None = None) -> list:
    """Detect statistically unusual delayed moves without changing the daily snapshot."""
    received_at = received_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state = _load(MOVEMENT_STATE_FILE, {})
    alerts = []
    for rec in recs:
        code = rec.get("code")
        name = rec.get("name") or _verified_name(code)
        if not code:
            continue
        try:
            frame = _load_history(code)
            closes = [float(value) for value in frame["Close"].dropna().tolist()]
            volumes = [float(value) for value in frame["Volume"].dropna().tolist()]
            returns = [100 * (closes[index] / closes[index - 1] - 1) for index in range(1, len(closes)) if closes[index - 1] > 0]
            baseline = returns[-21:-1]
            if len(baseline) < 20:
                result = detect_unusual_movement({"code": code, "name": name, "fresh": False, "comparable_observations": len(baseline)}, state)
            else:
                median = statistics.median(baseline)
                mad = statistics.median(abs(value - median) for value in baseline)
                robust_z = 0.6745 * (returns[-1] - median) / mad if mad > 0 else 0.0
                volume_baseline = statistics.median(volumes[-21:-1]) if len(volumes) >= 21 else 0.0
                result = detect_unusual_movement({"code": code, "name": name, "excess_move_pct": returns[-1] - median, "robust_z": robust_z,
                                                   "volume_ratio": volumes[-1] / volume_baseline if volume_baseline > 0 else 0.0,
                                                   "observed_at": received_at, "received_at": received_at, "fresh": True,
                                                   "comparable_observations": len(baseline)}, state)
            state = result["state"]
            if result["alert"]:
                alerts.append(result["alert"])
        except Exception as exc:
            print(f"movement check unavailable for {code}: {exc}")
    _save(MOVEMENT_STATE_FILE, state)
    return alerts


def mode_run() -> int:
    _regime, recs, _budget = _collect_recs(include_news=False, record_history=False)
    movement_alerts = _movement_alerts(recs)
    _save(ALERTS_FILE, {"alerts": movement_alerts})
    if movement_alerts:
        as_of = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        msg = nt.build_movement_alert_message(movement_alerts, as_of)
        ok = nt.send_discord(msg)
        print("movement alert sent:", ok, "| alerts:", len(movement_alerts))
        return 0 if ok else 1
    print("no new unusual movement; nothing sent.")
    return 0


# --- validation modes (local only, not on the schedule) ---------------------
# These are slow and produce large caches. They exist to answer "do these
# thresholds actually work", which nothing else in the repo can.
def _backtest_codes() -> list:
    """The broad TASI universe if it has been probed, else just your own names
    (enough to smoke-test the harness, never enough to tune on)."""
    import universe
    codes = universe.load()
    if codes:
        return codes
    print("universe.json missing — falling back to config names only. "
          "Run MODE=universe first for a tunable sample size.")
    return [x["code"] for x in cfg.HOLDINGS + cfg.WATCHLIST]


def mode_universe() -> int:
    import universe
    print(f"probing {len(universe.candidate_codes())} candidate Tadawul codes "
          f"(~30 min; partial results are saved after every batch)")
    codes = universe.discover()
    print(f"\n{len(codes)} listed names -> {universe.UNIVERSE_FILE.name}")
    return 0


def mode_features() -> int:
    import backtest as bt
    codes = _backtest_codes()
    index_code = cfg.REGIME["index_code"]
    print(f"loading {len(codes)} histories (adjusted, {bt.HISTORY_YEARS}y)")
    hist = bt.load_adjusted(codes, bt.HISTORY_YEARS)
    index_df = bt.load_adjusted([index_code], bt.HISTORY_YEARS).get(index_code)

    usable = {c: d for c, d in hist.items() if d is not None and not d.empty}
    done = bt.checkpointed_codes()
    if done:
        print(f"resuming: {len(done)} codes already in {bt.FEATURES_FILE.name}")
    print(f"{len(usable)}/{len(codes)} have data. Building features "
          f"(slow by design — it calls the same indicators production does)")
    feat = bt.build_features(usable, index_df, bt.STEP_DAYS,
                             checkpoint_every=25, done_codes=done)
    print(f"\n{len(feat)} feature rows across {feat['code'].nunique()} names "
          f"-> {bt.FEATURES_FILE}")
    return 0


def mode_backtest() -> int:
    import backtest as bt
    feat = bt.load_features()
    if feat.empty:
        print("no features. Run MODE=features first.")
        return 1

    codes = sorted(feat["code"].astype(str).unique())
    hist = bt.load_adjusted(codes, bt.HISTORY_YEARS)
    index_df = bt.load_adjusted([cfg.REGIME["index_code"]],
                                bt.HISTORY_YEARS).get(cfg.REGIME["index_code"])

    sweep_kind = os.environ.get("SWEEP", "").strip().lower()
    if sweep_kind in ("levels", "atr"):
        table = bt.sweep_levels(feat, hist, index_df)
        cols = ["stop_atr", "target_atr", "rr", "events", "expectancy_pct",
                "win_rate_pct", "payoff_ratio", "edge_vs_baseline_pct"]
        print("\n" + table[[c for c in cols if c in table.columns]]
              .to_string(index=False))
        return 0

    if sweep_kind:
        table = bt.sweep(feat, hist, index_df)
        cols = ["rsi_band", "mom_floor", "events",
                "expectancy_pct", "win_rate_pct", "timeout_pct",
                "edge_vs_baseline_pct"]
        print("\n" + table[[c for c in cols if c in table.columns]]
              .to_string(index=False))
        print("\nRead the events column first. A high expectancy on a handful "
              "of trades is noise, not a threshold.")
        return 0

    events = bt.run(feat, hist)
    overlaps = bt.check_no_overlap(events)
    if overlaps:
        print(f"FAIL: {len(overlaps)} overlapping events — the numbers below are "
              f"contaminated. First: {overlaps[:3]}")
        return 1

    rep = bt.report(events, index_df)
    print(f"\nBacktest over {len(codes)} names, {bt.HISTORY_YEARS}y, "
          f"{bt.STEP_DAYS}-day step")
    print("Survivorship: only currently-listed names were probed.\n")
    for k, v in rep.items():
        print(f"  {k:<24} {v}")
    if not events.empty:
        bt.CACHE.mkdir(parents=True, exist_ok=True)
        events.to_csv(bt.CACHE / "events.csv", index=False)
        print(f"\n{len(events)} events -> {bt.CACHE / 'events.csv'}")
    return 0


MODES = {
    "heartbeat": mode_heartbeat,
    "discord-smoke": mode_discord_smoke,
    "suggest": mode_suggest,
    "autolevels": mode_autolevels,
    "digest": mode_digest,
    "research-evidence": mode_research_evidence,
    "top10-draft": mode_top10_draft,
    "cockpit-refresh": mode_cockpit_refresh,
    "run": mode_run,
    "universe": mode_universe,
    "features": mode_features,
    "backtest": mode_backtest,
}


def main() -> int:
    # Digest/reasons carry Arabic news + a ⚠ marker; force utf-8 so a Windows
    # cp1252 console does not crash on print (Discord delivery is utf-8 already).
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    mode = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("MODE", "run")).strip()
    fn = MODES.get(mode)
    if not fn:
        print(f"unknown mode '{mode}'. choose: {', '.join(MODES)}")
        return 2
    return fn()


if __name__ == "__main__":
    raise SystemExit(main())
