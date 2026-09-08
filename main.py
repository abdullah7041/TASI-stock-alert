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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import config as cfg
import data as dat
import analyze as az
import artifacts
import notify as nt
import indicators as ind
import history as histmod
import disclosures as discl
import session_gate
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
# Fetched per run from the cockpit by the workflow, like top10_active.json.
PORTFOLIO_FILE = HERE / "portfolio_active.json"
HISTORY_FILE = HERE / "history.json"
DASHBOARD_FILE = HERE / "dashboard.json"
TOP10_FILE = HERE / "top10_draft.json"
TOP10_ACTIVE_FILE = HERE / "top10_active.json"
MOVEMENT_STATE_FILE = HERE / "movement_state.json"
ALERTS_FILE = HERE / "movement_alerts.json"
EVIDENCE_FILE = HERE / "research" / "evidence.json"
FORECAST_METRICS_FILE = HERE / "research" / "forecast_metrics.json"
EVIDENCE_QUEUE_FILE = HERE / "research" / "evidence_queue.json"
PROBE_FILE = HERE / "research" / "intraday_probe.json"


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


def _portfolio_ledger() -> dict | None:
    """The confirmed portfolio, as recorded by you, or None when unavailable.

    Written by the workflow from the cockpit's authenticated read, in the same
    way top10_active.json already is. Shape:

        {"view": {"cashSar": float, "holdings": [...], "contributionMonth": str},
         "spentThisMonthSar": float, "month": "YYYY-MM"}

    None means the fetch did not happen or the file is unusable -- never that
    the portfolio is empty. Interactive/local runs may retain the legacy
    fallback, while production decision workflows require the confirmed ledger.
    """
    value = _load(PORTFOLIO_FILE, None)
    if not isinstance(value, dict) or not isinstance(value.get("view"), dict):
        if os.getenv("TASI_REQUIRE_PORTFOLIO_LEDGER", "").lower() == "true":
            raise RuntimeError("Confirmed portfolio ledger is required but unavailable.")
        return None
    if (os.getenv("TASI_REQUIRE_PORTFOLIO_LEDGER", "").lower() == "true"
            and (not isinstance(value.get("eventCount"), int) or value["eventCount"] <= 0)):
        raise RuntimeError("Confirmed portfolio ledger requires an imported opening balance.")
    return value


def _holdings() -> list[dict]:
    """What you own, ledger first, config.py as the backstop.

    config.HOLDINGS was the only source and it is hand-edited: recording that
    you bought 20 more shares meant editing Python and recomputing a weighted
    average cost yourself. The ledger does that arithmetic; this is where it
    takes over, without ever leaving the digest with nothing to report.
    """
    ledger = _portfolio_ledger()
    holdings = ((ledger or {}).get("view") or {}).get("holdings") or []
    event_count = (ledger or {}).get("eventCount", 0)
    if not holdings and not event_count:
        return list(cfg.HOLDINGS)
    return [
        {"code": str(item["code"]), "name": str(item.get("name") or item["code"]),
         "shares": int(item.get("shares") or 0),
         "avg_cost": float(item.get("avgCostSar") or 0.0)}
        for item in holdings if int(item.get("shares") or 0) > 0
    ]


def _budget_spent_this_month() -> float:
    """What you have actually SPENT this calendar month.

    This used to be what the engine had *recommended*, read from
    budget_state.json -- so a suggestion you ignored still consumed your budget,
    and the documented remedy was editing that file by hand (README, "Monthly
    buy budget"). Recommendations are not purchases. The ledger knows the
    difference because you tell it.
    """
    ledger = _portfolio_ledger()
    if ledger is not None and ledger.get("month") == _month_key():
        return max(0.0, float(ledger.get("spentThisMonthSar") or 0.0))
    # No ledger yet: fall back to the old recommendation ledger rather than
    # reporting a full budget that may already be spent.
    state = _load(BUDGET_FILE, {})
    return float(state.get(_month_key(), {}).get("spent", 0.0))


def _budget_remaining() -> float:
    """Monthly cap minus what you have actually spent this calendar month.

    Fresh cap every month: unspent budget does not roll over. The ledger's cash
    balance does carry forward, because that is a true statement about money --
    but the CAP is a spending rule, and it resets.
    """
    return max(0.0, cfg.BUDGET["monthly_budget_sar"] - _budget_spent_this_month())


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
    # The lean is stored with the day's price so mode_reconcile can grade it
    # later against what actually happened. A lean that is never scored is the
    # conviction score all over again (docs/backtest-findings-2026-07-23.md):
    # a number nobody can falsify. Storing the claim is what makes it
    # falsifiable, and history.record_snapshot already caps at 90 days per code.
    lean = rec.get("lean") or {}
    return {"price": rec["price"], "rsi": lt.get("rsi"), "trend": lt.get("trend"),
            "rules_met": rules_met, "blocking": blocking,
            "lean": lean.get("lean"), "lean_confidence": lean.get("confidence")}


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


def _active_top10() -> dict | None:
    """Read an approved list fetched from the owner-only cockpit, if any."""
    value = _load(TOP10_ACTIVE_FILE, None)
    if isinstance(value, dict) and value.get("status") == "approved" and value.get("entries"):
        return value
    return None


def _top10_review_due(active: dict | None, today: date) -> bool:
    """Initial draft immediately; later drafts only after their 3-month date."""
    trading_day = today.weekday() in (6, 0, 1, 2, 3)  # Riyadh trading Sun-Thu
    if not active:
        return trading_day
    due_text = str(active.get("nextReviewAt") or "")[:10]
    try:
        due = date.fromisoformat(due_text)
    except ValueError:
        # nextReviewAt is only written by approvals made since it existed. An
        # older approved list carries none, and treating that as "not due" would
        # freeze it permanently -- no review, ever, without editing the database
        # by hand. An unscheduled review is an overdue one.
        return trading_day
    return today >= due and trading_day


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
    owned = {item["code"] for item in _holdings()}
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
    return {"proposalId": f"top10-{generated_at[:10]}-evidence", "status": "draft", "researchedAt": generated_at,
            "reviewWindow": "1-3 months", "entries": entries}


def _forecast(generated_at: str) -> dict:
    metrics = _load(FORECAST_METRICS_FILE, {})
    return unavailable_forecast(generated_at[:10], metrics, bool(metrics.get("survivorship_limited", True)))


def _changed_entries(recs: list) -> list:
    """Names whose day-over-day state actually moved.

    `changed` was a hardcoded `[]` here from the day the v2 snapshot landed,
    which is why the cockpit and the digest both reported "nothing changed"
    every single day. The data was never missing: _collect_recs already
    attaches history.compute_delta output to every rec as `delta` (and
    compute_streak as `trend_streak`) whenever record_history is on. This just
    reads what was already computed.

    A rec with `delta is None` is a name's first recorded session, not an
    unchanged one, and is deliberately excluded rather than reported as flat.
    """
    entries = []
    for rec in recs:
        delta = rec.get("delta")
        if not nt._is_changed(delta):
            continue
        moves = []
        if delta.get("price_pct") is not None:
            moves.append(f"price {delta['price_pct']:+.1f}%")
        if delta.get("rsi_delta") is not None:
            moves.append(f"RSI {delta['rsi_delta']:+.1f}")
        if delta.get("rules_met_delta"):
            moves.append(f"rules met {delta['rules_met_delta']:+d}")
        if delta.get("trend_flipped"):
            moves.append("trend flipped")
        for rule in delta.get("flipped") or []:
            moves.append(f"{rule} flipped")
        # Keys are fixed by the cockpit's own validator, not chosen here:
        # app/lib/dashboard-core.mjs:82 reads exactly code/name/status/reason
        # through text(), which throws on anything missing. `changed` has been
        # a hardcoded [] since schemaVersion 2 shipped, so this list has never
        # once been exercised against that validator -- the first non-empty
        # payload is the first real test of the contract.
        entries.append({
            "code": rec["code"], "name": rec["name"],
            "status": rec["action"], "reason": "; ".join(moves),
        })
    return entries


def _dashboard_snapshot(regime: str, recs: list, budget: dict, scanner_result: dict | None, *, as_of: str | None = None, top10: dict | None = None, top10_review: dict | None = None, alerts: list | None = None, scheduled_for: str | None = None) -> dict:
    """Serialize one delayed daily digest for the private cockpit."""
    generated_at = as_of or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    # Manual operations used the literal "manual" historically. Keep such
    # source metadata honest but never emit an invalid timestamp into v3. The
    # same rule has to hold for the artifact's own scheduledFor, so it lives in
    # artifacts.py and both callers use it -- sanitising here alone is what let
    # summaryV1.scheduledFor and artifact.scheduledFor disagree.
    scheduled_for = artifacts.timestamp_or_none(scheduled_for)
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
    # The 265-name scan runs every morning and almost none of it reached the
    # reader: only conditions_met == 2 became `qualified`, which was zero names
    # on every recent run, and the rest was reduced to a bare count. Carry the
    # ranked candidates themselves so the digest can show the early movers it
    # already paid to compute.
    early_movers = [
        {"code": c["code"], "name": names.get(c["code"], c["code"]),
         "price": round(float(c.get("price") or 0.0), 2),
         "conditionsMet": int(c.get("conditions_met") or 0),
         "relativeStrengthPct": round(float(c.get("rel_strength") or 0.0), 1),
         "relativeStrengthMet": bool(c.get("rel_strength_met")),
         "squeeze": bool(c.get("squeeze_met"))}
        for c in candidates[:EARLY_MOVER_COUNT]
    ]
    warning = (scanner_result or {}).get("warning")
    warnings = [warning] if warning else []
    if _INDEX_WARNING:
        warnings.append(_INDEX_WARNING)
    if _DATA_WARNING:
        warnings.append(_DATA_WARNING)
    if _LATE_WARNING:
        warnings.append(_LATE_WARNING)
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
        for item in _holdings()
    ]
    ledger_view = ((_portfolio_ledger() or {}).get("view") or {})
    snapshot = {"schemaVersion": 2, "tradeDate": generated_at[:10], "asOf": generated_at,
                "regime": regime, "dataStatus": "delayed-daily", "warnings": warnings,
                "urgent": urgent, "changed": _changed_entries(recs), "qualified": qualified,
                "researchCount": len([c for c in candidates if c.get("conditions_met") == 1]),
                "earlyMovers": early_movers,
                "indexUnavailable": bool((scanner_result or {}).get("indexUnavailable")),
                "monthlyBudgetSar": budget.get("monthly_cap"), "top10": top10,
                # cashSar and contributionMonth were hardcoded 0.0/None, so the
                # cockpit could only ever say "0.00 SAR cash" no matter what the
                # ledger held. They come from the ledger now when there is one.
                "portfolio": {"confirmedAt": (ledger_view.get("confirmedAt") or generated_at),
                              "cashSar": float(ledger_view.get("cashSar") or 0.0),
                              "contributionMonth": ledger_view.get("contributionMonth"),
                              "holdings": holdings, "proposal": None},
                "alerts": alerts or [], "forecast": _forecast(generated_at)}
    if top10_review is not None:
        snapshot["top10Review"] = top10_review
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
    dat.get_histories([x["code"] for x in _holdings() + cfg.WATCHLIST],
                      cfg.TECH["history_period"])  # one batch; loop reads cache.
    for item in _holdings() + cfg.WATCHLIST:
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
    dat.get_histories([x["code"] for x in _holdings() + cfg.WATCHLIST],
                      cfg.TECH["history_period"])  # one batch; loop reads cache.
    for item in _holdings() + cfg.WATCHLIST:
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


# Set by _collect_recs; read by _dashboard_snapshot. None means no index problem.
# How many ranked scanner candidates travel to the reader. The scan itself is
# capped at SCANNER["top_n"]; this is how much of that survives into the digest.
EARLY_MOVER_COUNT = 5

_INDEX_WARNING: str | None = None
# Set by _collect_recs; read by _dashboard_snapshot. None means every name got
# usable price history. data.get_histories absorbs a source outage and returns
# empty frames, which the record loops below skip with `continue` -- so without
# this, a total Yahoo failure ships a correctly-formatted digest containing no
# names at all, and reads exactly like a quiet market.
_DATA_WARNING: str | None = None
# Set by main() when a scheduled digest lands after its intended window. A late
# digest still ships -- it just has to say so, because its prices are the
# previous close and the reader must not mistake them for this morning's.
_LATE_WARNING: str | None = None


def _completed_history(frame, before_date: str):
    """Keep only fully completed daily bars before the snapshot trade date."""
    if frame is None or frame.empty:
        return frame
    return frame.loc[[str(index)[:10] < before_date for index in frame.index]]


def _collect_recs(include_news: bool, record_history: bool = False,
                  completed_before: str | None = None):
    """Returns (regime, recs, budget_summary).

    Speed: one batched Yahoo download for every name PLUS the index (was 14
    serial HTTP calls), news fetched in parallel threads (was 20 serial RSS
    requests), levels.json loaded once (was once per name).
    """
    index_code = cfg.REGIME["index_code"]
    all_codes = [x["code"] for x in _holdings() + cfg.WATCHLIST] + [index_code]
    hist = dat.get_histories(all_codes, cfg.TECH["history_period"])
    if completed_before:
        hist = {code: _completed_history(frame, completed_before)
                for code, frame in hist.items()}

    idx = hist.get(index_code)
    if idx is None or idx.empty:
        idx = dat.get_index_history(index_code)  # SAHMK fallback path.
        if completed_before:
            idx = _completed_history(idx, completed_before)
    regime = az.market_regime(idx, cfg.REGIME["index_ma"])
    # market_regime returns 'unknown' only when the index frame is empty or
    # too short. Left unsaid, that reads identically to a genuinely
    # indeterminate market -- and it hid a real outage: every snapshot from
    # 2026-08-18 onward carried regime 'unknown' with nothing anywhere saying
    # the ^TASI.SR fetch had stopped returning data.
    global _INDEX_WARNING
    _INDEX_WARNING = None
    if regime == "unknown":
        bars = 0 if idx is None or idx.empty else len(idx)
        _INDEX_WARNING = (
            f"Market regime unavailable: the index ({index_code}) returned "
            f"{bars} usable bars this run, so no regime could be computed.")
        print(_INDEX_WARNING)

    # The index has its own warning above; this covers the tradeable names.
    global _DATA_WARNING
    _DATA_WARNING = None
    tradeable = [x["code"] for x in cfg.HOLDINGS + cfg.WATCHLIST]
    missing = [c for c in tradeable
               if hist.get(c) is None or hist[c].empty]
    if missing:
        if len(missing) == len(tradeable):
            _DATA_WARNING = (
                f"No price history returned for ANY of the {len(tradeable)} "
                f"names this run. This digest is empty because the data source "
                f"failed, not because nothing happened.")
        else:
            _DATA_WARNING = (
                f"Price history unavailable for {len(missing)} of "
                f"{len(tradeable)} names ({', '.join(sorted(missing))}). They "
                f"are absent from this digest — absence here is not evidence "
                f"they were quiet.")
        print(_DATA_WARNING)

    stored_levels = _load(LEVELS_FILE, {})
    verify = _verify_symbols(_holdings() + cfg.WATCHLIST)

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
            news_by_code = dict(ex.map(_fetch, _holdings() + cfg.WATCHLIST))

        for code, result in news_by_code.items():
            newsmod.archive_headlines(code, result)

    all_disclosures, disclosures_ok = discl.fetch_all()

    unverified = []
    recs = []
    for h in _holdings():
        df = hist.get(h["code"])
        if df is None or df.empty:
            continue
        price = float(df["Close"].iloc[-1])
        disc = discl.match_company(all_disclosures, disclosures_ok, discl.aliases_for(h))
        rec = az.evaluate_holding(h, price, df, _levels_for(h["code"], stored_levels),
                                  cfg.HORIZON, cfg.TECH, news_by_code.get(h["code"]), disc)
        rec["priceDate"] = str(df.index[-1])[:10]
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
        rec["priceDate"] = str(df.index[-1])[:10]
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
                                        current_positions=len(_holdings()),
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


CHART_DIR = HERE / ".charts"


def _chart_bundle(recs: list, completed_before: str | None = None) -> tuple[dict, dict, list[dict]]:
    """Render one candlestick+volume chart per name for the pre-open digest.

    Returns ({code: filename}, {filename: Path}) -- the first for the embeds,
    the second for the upload. Pre-open only: the session mode runs ~20 times a
    day and eleven PNGs on each would be slow and rate-limited for no gain.

    Fail-soft throughout, like _scanner_result. A chart is an enhancement to a
    digest that already reads well as text, so a matplotlib problem or a thin
    history must cost you the picture, never the message.
    """
    codes = [r["code"] for r in recs]
    # Read before the fetch: levels.json is local and has nothing to do with
    # whether history arrives. Loading it inside the success path meant a failed
    # fetch cost every name its stop and target as well as its picture.
    stored_levels = _load(LEVELS_FILE, {})
    try:
        frames = dat.get_histories(codes, cfg.TECH["history_period"])
        if completed_before:
            frames = {code: _completed_history(frame, completed_before)
                      for code, frame in frames.items()}
    except Exception as exc:
        print(f"charts: history fetch failed ({type(exc).__name__}) — sending text only")
        return {}, {}, artifacts.chart_artifacts(recs, {}, stored_levels)

    chart_data = artifacts.chart_artifacts(recs, frames, stored_levels)
    try:
        import charts as chartmod
    except Exception as exc:
        print(f"Discord chart rendering unavailable ({type(exc).__name__}: {exc}) â€” structured charts retained")
        return {}, {}, chart_data
    by_code, by_name = {}, {}
    for rec in recs:
        try:
            path = chartmod.render(rec["code"], rec["name"], frames.get(rec["code"]),
                                   stored_levels.get(rec["code"]), CHART_DIR)
        except Exception as exc:
            print(f"charts: {rec['code']} failed ({type(exc).__name__}: {exc})")
            continue
        if path is not None:
            by_code[rec["code"]] = path.name
            by_name[path.name] = path
    print(f"charts rendered: {len(by_code)}/{len(recs)}")
    return by_code, by_name, chart_data


def _render_charts(recs: list) -> tuple[dict, dict]:
    """Compatibility wrapper for callers that only need Discord PNGs."""
    by_code, by_name, _chart_data = _chart_bundle(recs)
    return by_code, by_name


def _attach_leans(recs: list) -> dict:
    """Ask the model for a pre-open lean and attach it to each rec, in place.

    Deliberately runs AFTER the dashboard snapshot is saved. The lean is the one
    part of the digest that depends on a third-party API, and a model outage
    must not be able to cost the run its state -- the same failure mode that
    made a Discord outage discard a day of history until this change set.

    Every rec gets a `lean`: either a take, or an `unavailable` reason. A name
    the model skipped is marked as skipped rather than left bare, so a partial
    response is visible instead of looking like a quiet name.
    """
    try:
        import llm
        leans = llm.get_leans(recs)
    except Exception as exc:  # a bad import must not take the digest down
        leans = {"_status": {"ok": False, "reason": f"lean unavailable ({type(exc).__name__})"}}

    status = leans.get("_status") or {}
    if not status.get("ok"):
        # The V3 artifact is validated by the cockpit. A model outage is
        # expected input, so its status must remain structurally complete.
        status = {
            "ok": False,
            "provider": str(status.get("provider") or "gemini"),
            "reason": str(status.get("reason") or "unknown"),
        }
        for key in ("model", "errorType", "errorCategory"):
            value = (leans.get("_status") or {}).get(key)
            if isinstance(value, str) and value:
                status[key] = value
        http_status = (leans.get("_status") or {}).get("httpStatus")
        if type(http_status) is int and 400 <= http_status <= 599:
            status["httpStatus"] = http_status
        reason = status["reason"]
        print(f"pre-open lean unavailable: {reason}")
        for rec in recs:
            rec["lean"] = {"unavailable": reason}
        return status

    print(f"pre-open lean: {len(leans) - 1} takes from {status.get('model')}, "
          f"{status.get('calls_left')} calls left this month")
    for rec in recs:
        take = leans.get(rec["code"])
        rec["lean"] = take or {"unavailable": "the model returned no take for this name"}
    return status


def _persist_attached_leans(recs: list) -> None:
    """Record the optional model claims after the daily snapshot is already safe.

    History and the dashboard are intentionally written before the model call so
    a provider outage cannot erase the deterministic digest. Once a response is
    attached, update only today's existing history row; this makes every
    directional claim available to ``mode_reconcile`` without letting the model
    create a new market snapshot.
    """
    history = _load(HISTORY_FILE, {})
    today = _today()
    changed = False
    for rec in recs:
        lean = rec.get("lean") or {}
        for entry in reversed(history.get(rec.get("code"), [])):
            if entry.get("date") != today:
                continue
            next_lean = lean.get("lean")
            next_confidence = lean.get("confidence")
            if (entry.get("lean"), entry.get("lean_confidence")) != (next_lean, next_confidence):
                entry["lean"] = next_lean
                entry["lean_confidence"] = next_confidence
                changed = True
            break
    if changed:
        _save(HISTORY_FILE, history)


def _delivered_digest_today() -> dict | None:
    """Today's digest artifact IF it actually reached Discord, else None.

    `artifactKind` alone does not answer this: cockpit-refresh and top10-draft
    build digest-shaped artifacts too, and neither sends anything. Only a
    delivered digest records `deliveries.discord`, and that key is in
    artifacts.IDENTITY_EXCLUDED_FIELDS, so writing it never re-identifies the
    artifact whose delivery it is describing.
    """
    snapshot = _load(DASHBOARD_FILE, None) or {}
    if snapshot.get("artifactKind") != "digest" or snapshot.get("tradeDate") != _today():
        return None
    discord = (snapshot.get("deliveries") or {}).get("discord") or {}
    return snapshot if discord.get("status") == "success" else None


def mode_digest_guard() -> int:
    """Send the pre-open digest only if today's has not already gone out.

    GitHub's scheduler drops triggers as well as delaying them: over the week to
    2026-08-25 roughly half the every-15-minute session slots produced no run at
    all. A dropped digest is the one that costs you the morning, so a second
    trigger fires 40 minutes later and asks one question -- did today's digest
    ship? -- before deciding whether to do anything.

    The check is the committed artifact's own delivery receipt, because a
    snapshot written by some other mode is not a digest anybody read. On a
    normal day this exits without touching the network.
    """
    if os.environ.get("TASI_PRODUCTION_DELIVERED", "").strip().lower() == "true":
        print(f"production confirms today's artifact reached Cockpit and Discord; nothing to do.")
        return 0
    delivered = _delivered_digest_today()
    today = _today()
    if delivered is not None:
        print(f"digest for {today} already shipped ({delivered.get('asOf')}); nothing to do.")
        return 0
    if not session_gate.is_pre_open_window():
        # The backstop is allowed past the open, but the reader must be told:
        # the same honesty rule a late scheduled digest already follows.
        global _LATE_WARNING
        _LATE_WARNING = (
            "The scheduled pre-open digest did not run, so this backstop sent it "
            "after the open. Prices are the previous session's close.")
    print(f"no digest delivered for {today}; sending now.")
    return mode_digest()


def mode_digest() -> int:
    scheduled = artifacts.timestamp_or_none(os.environ.get("SCHEDULED_FOR"))
    regime, recs, budget = _collect_recs(
        include_news=True,
        record_history=True,
        completed_before=(scheduled or _today())[:10],
    )
    scanner_result = _scanner_result()
    snapshot = _dashboard_snapshot(
        regime, recs, budget, scanner_result,
        top10=_active_top10() or _load(TOP10_FILE, _unavailable_top10(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))),
        top10_review=_load(TOP10_FILE, None),
        scheduled_for=os.environ.get("SCHEDULED_FOR"),
    )
    # Deterministic market/history state is durable before Gemini and charts.
    _save(DASHBOARD_FILE, snapshot)
    lean_status = _attach_leans(recs)
    _persist_attached_leans(recs)

    charts_by_code, chart_files, chart_data = _chart_bundle(
        recs, completed_before=(scheduled or _today())[:10])
    artifact = artifacts.build_digest_artifact(
        snapshot, recs=recs, lean_status=lean_status, charts=chart_data,
        scheduled_for=os.environ.get("SCHEDULED_FOR"),
    )
    _save(DASHBOARD_FILE, artifact)
    embeds = nt.build_digest_embeds(
        artifact=artifact, charts_by_code=charts_by_code,
    )
    ok = nt.send_discord(embeds=embeds, files=chart_files)
    # Record the outcome ON the artifact. "deliveries" is excluded from the
    # identity hash, so this is the one fact about a digest that can be written
    # after the fact without changing which digest it is -- which is what lets
    # digest-guard and cockpit-refresh tell a delivered digest from a rebuilt one.
    artifact["deliveries"] = {"discord": {
        "status": "success" if ok else "failure",
        "attemptedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}}
    _save(DASHBOARD_FILE, artifact)
    if not ok:
        # No webhook configured (a local run), or Discord is down. Either way
        # the digest itself succeeded and its state is already on disk.
        print(nt.build_dashboard_digest(snapshot))
    print("digest sent:", ok, "| recs:", len(recs), "| embeds:", len(embeds))
    # The workflow commits state even when this returns non-zero, then surfaces
    # the delivery failure. A green run without a Discord digest is worse than
    # a visible failure, but a failed webhook must not discard the day's state.
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


def mode_top10_draft(today: date | None = None) -> int:
    """Create a dated draft snapshot; user approval remains required on the site.

    `today` is injectable for the same reason session_gate's functions take an
    explicit `now`: the review gate below is a calendar decision, and a test
    that lets it read the wall clock passes Sun-Thu and fails Fri-Sat. MODES
    dispatches this with no argument, so the default keeps production behaviour.
    """
    active = _active_top10()
    pending = _load(TOP10_FILE, None)
    if not active and isinstance(pending, dict) and pending.get("status") == "draft" and pending.get("entries"):
        print("Initial Top 10 draft is awaiting approval; it remains unchanged.")
        return 0
    if not _top10_review_due(active, today or date.today()):
        print("Top 10 review is not due; approved list remains unchanged.")
        return 0
    regime, recs, budget = _collect_recs(include_news=True, record_history=False)
    scanner_result = _scanner_result()
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    draft = _evidence_top10(scanner_result, recs, generated_at) or _unavailable_top10(generated_at)
    _save(TOP10_FILE, draft)
    if _delivered_digest_today() is not None:
        # Writing the draft is this mode's job; replacing the day's delivered
        # digest is not. This run has no charts and no lean, so saving it would
        # strip both from the cockpit and re-identify the artifact. The draft is
        # on disk and tomorrow's digest publishes it as top10Review.
        print("Top 10 evidence draft written; today's delivered digest kept as the artifact.")
        return 0
    snapshot = _dashboard_snapshot(regime, recs, budget, scanner_result, as_of=generated_at,
                                   top10=active or draft, top10_review=draft,
                                   scheduled_for=os.environ.get("SCHEDULED_FOR"))
    _save(DASHBOARD_FILE, artifacts.build_digest_artifact(
        snapshot, recs=recs,
        lean_status={"ok": False, "provider": "gemini", "reason": "Gemini is not run for a Top 10 review."},
        charts=[], scheduled_for=os.environ.get("SCHEDULED_FOR"),
    ))
    print("Top 10 evidence draft snapshot written; no list was approved or traded.")
    return 0


def mode_cockpit_refresh() -> int:
    """Validate the canonical artifact for an idempotent workflow replay.

    The workflow performs the authenticated D1 replay. This mode deliberately
    does not collect market data, invoke AI, send Discord, or rewrite identity.
    """
    artifact = _load(DASHBOARD_FILE, None)
    if not isinstance(artifact, dict) or artifact.get("schemaVersion") != 3 or not artifact.get("artifactId"):
        print("cockpit refresh unavailable: no canonical schema-v3 artifact exists.")
        return 1
    print(f"cockpit refresh will replay {artifact['artifactId']}; no data was regenerated or sent to Discord.")
    return 0


def _verified_name(code: str | None, catalog: dict | None = None) -> str:
    """Resolve a company name from the verified symbol catalog, never from the code."""
    entry = (catalog if catalog is not None else _load(SYMBOLS_FILE, {})).get(str(code or ""), {})
    return str(entry.get("config_name") or "").strip() if entry.get("verified") else ""


# A move smaller than this is called flat rather than scored as a direction.
# Without it, a +0.02% session would grade a "positive" lean as correct, and the
# hit rate would measure rounding noise instead of skill.
LEAN_FLAT_BAND_PCT = 0.5


def grade_leans(history: dict, today: str) -> dict:
    """Score each recorded lean against the move that followed it.

    Reads only history.json, which already holds one dated snapshot per code
    with the lean attached by _snapshot_for. Pure: takes history, returns a
    report, writes nothing.

    A lean is graded against the NEXT session's close, so the entry being
    scored is the one the reader could actually have acted on. Sessions with no
    following bar yet are ungraded, not counted as misses.
    """
    graded, hits, misses, flat = [], 0, 0, 0
    for code, entries in history.items():
        ordered = sorted((e for e in entries if e.get("date") <= today),
                         key=lambda e: e["date"])
        for prior, following in zip(ordered, ordered[1:]):
            lean = prior.get("lean")
            if lean not in ("positive", "negative"):
                continue  # neutral and absent leans make no directional claim
            before, after = prior.get("price"), following.get("price")
            if not before or after is None:
                continue
            move = (after - before) / before * 100
            if abs(move) < LEAN_FLAT_BAND_PCT:
                outcome = "flat"
                flat += 1
            elif (move > 0) == (lean == "positive"):
                outcome = "hit"
                hits += 1
            else:
                outcome = "miss"
                misses += 1
            graded.append({"code": code, "date": prior["date"], "lean": lean,
                           "confidence": prior.get("lean_confidence"),
                           "movePct": round(move, 2), "outcome": outcome})
    directional = hits + misses
    return {
        "graded": len(graded), "hits": hits, "misses": misses, "flat": flat,
        "hitRatePct": round(hits / directional * 100, 1) if directional else None,
        "flatBandPct": LEAN_FLAT_BAND_PCT,
        "detail": graded[-20:],
    }


def mode_reconcile() -> int:
    """After the close: refresh the cockpit snapshot and print a health summary.

    Deliberately silent on Discord. The reconciliation run exists to answer
    "did today's schedule actually do its job", and a message at 15:10 saying
    nothing happened is noise, not evidence.
    """
    exit_code = mode_cockpit_refresh()
    snapshot = _load(DASHBOARD_FILE, {}) or {}
    alerts = (_load(ALERTS_FILE, {}) or {}).get("alerts") or []
    summary = {
        "tradeDate": snapshot.get("tradeDate"),
        "asOf": snapshot.get("asOf"),
        "schemaVersion": snapshot.get("schemaVersion"),
        "movementAlertCount": len(alerts),
        "unnamedAlertCount": sum(1 for alert in alerts if not str(alert.get("name") or "").strip()),
        "warnings": snapshot.get("warnings") or [],
    }
    scorecard = grade_leans(_load(HISTORY_FILE, {}), _today())
    summary["leanScorecard"] = {k: v for k, v in scorecard.items() if k != "detail"}
    print("reconciliation:", json.dumps(summary, ensure_ascii=False, sort_keys=True))
    if scorecard["hitRatePct"] is not None:
        print(f"lean scorecard: {scorecard['hits']}/{scorecard['hits'] + scorecard['misses']} "
              f"directional calls correct ({scorecard['hitRatePct']}%), "
              f"{scorecard['flat']} landed inside the ±{LEAN_FLAT_BAND_PCT}% flat band")
    return exit_code


def _movement_alerts(recs: list, received_at: str | None = None, state: dict | None = None,
                     save_state=None) -> list:
    """Detect statistically unusual delayed moves without changing the daily snapshot.

    `state` and `save_state` exist for the managed runtime: a Cloud Run job has
    no disk that survives the run, so it supplies the re-arm map from Firestore
    and writes it back there. Both default to the repository file the GitHub
    schedule already uses.
    """
    received_at = received_at or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state = _load(MOVEMENT_STATE_FILE, {}) if state is None else dict(state)
    catalog = _load(SYMBOLS_FILE, {})
    alerts = []
    for rec in recs:
        code = rec.get("code")
        if not code:
            continue
        name = rec.get("name") or _verified_name(code, catalog)
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
    (save_state or (lambda value: _save(MOVEMENT_STATE_FILE, value)))(state)
    return alerts


def mode_run() -> int:
    _regime, recs, _budget = _collect_recs(include_news=False, record_history=False)
    movement_alerts = _movement_alerts(recs)
    as_of = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    movement_artifact = artifacts.build_movement_artifact(movement_alerts, as_of=as_of)
    _save(ALERTS_FILE, movement_artifact)
    if movement_alerts:
        msg = nt.build_movement_alert_message(movement_artifact["alerts"], movement_artifact["asOf"])
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
    return [x["code"] for x in _holdings() + cfg.WATCHLIST]


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


def mode_intraday_probe() -> int:
    """Answer one question with evidence: does Yahoo serve intraday bars for .SR?

    Everything intraday in this repo rests on an assumption nobody has ever
    tested. data.get_quote returns the last DAILY close, and movement.py runs
    its robust-z over DAILY returns -- yet the workflow invokes them every 15
    minutes and labels the result "delayed-intraday". If Yahoo does serve real
    intraday bars for Tadawul codes, that whole path can become what it claims
    to be. If it does not, the honest move is to stop pretending and run
    movement once after the close.

    Free-tier Yahoo is also known to serve intraday bars with a null volume
    column for some venues, which would look like working data right up until
    the volume ratio came out as None -- so bars alone are not the test.
    Volume coverage is measured per interval and reported separately.

    Writes research/intraday_probe.json. The workflow commits it, so the answer
    survives as evidence rather than a log line that scrolls away.
    """
    import yfinance as yf

    codes = [x["code"] for x in _holdings() + cfg.WATCHLIST] + [cfg.REGIME["index_code"]]
    attempts = [("5m", "5d"), ("15m", "5d"), ("15m", "1mo"), ("60m", "1mo")]
    results = []
    for code in codes:
        symbol = dat.yahoo_symbol(code)
        for interval, period in attempts:
            row = {"code": code, "symbol": symbol, "interval": interval, "period": period}
            try:
                df = yf.Ticker(symbol).history(period=period, interval=interval)
            except Exception as exc:
                row.update({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
                results.append(row)
                continue
            if df is None or df.empty:
                row.update({"ok": True, "bars": 0, "note": "empty frame"})
                results.append(row)
                continue
            volume = df["Volume"] if "Volume" in df.columns else None
            row.update({
                "ok": True,
                "bars": int(len(df)),
                "first": str(df.index[0]),
                "last": str(df.index[-1]),
                "distinct_days": int(len({str(ts)[:10] for ts in df.index})),
                "volume_column": volume is not None,
                "volume_non_null": int(volume.notna().sum()) if volume is not None else 0,
                "volume_non_zero": int((volume.fillna(0) > 0).sum()) if volume is not None else 0,
            })
            results.append(row)

    # The rule was written before the answer was known, so the answer cannot
    # move the bar: intraday ships only if most names return usable bars WITH
    # real volume at 15m or finer.
    #
    # The index is judged separately and excluded from the count. ^TASI.SR is
    # a computed index, not a traded instrument, so it has no volume of its own
    # and could never satisfy a volume rule -- including it would drag the
    # denominator down for a reason that has nothing to do with whether your
    # holdings have intraday data.
    stock_codes = [c for c in codes if not c.startswith("^")]
    required = max(1, round(len(stock_codes) * 0.7))
    usable = {
        r["code"] for r in results
        if r.get("ok") and r["interval"] in ("5m", "15m") and not r["code"].startswith("^")
        and r.get("bars", 0) >= 20 and r.get("volume_non_zero", 0) >= 20
    }
    index_bars = max((r.get("bars", 0) for r in results
                      if r["code"].startswith("^") and r["interval"] in ("5m", "15m")),
                     default=0)
    verdict = {
        "decidedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stockCodesProbed": len(stock_codes),
        "codesWithUsableIntraday": sorted(usable),
        "indexIntradayBars": index_bars,
        "threshold": f"at least {required} of {len(stock_codes)} stock codes with "
                     f">=20 bars and >=20 non-zero volumes at 15m or finer "
                     f"(the index is reported separately and does not count)",
        "intradayViable": len(usable) >= required,
    }
    _save(PROBE_FILE, {"verdict": verdict, "attempts": results})
    print(json.dumps(verdict, indent=2))
    print(f"wrote {PROBE_FILE}")
    return 0


MODES = {
    "heartbeat": mode_heartbeat,
    "discord-smoke": mode_discord_smoke,
    "suggest": mode_suggest,
    "autolevels": mode_autolevels,
    "digest": mode_digest,
    "digest-guard": mode_digest_guard,
    "research-evidence": mode_research_evidence,
    "top10-draft": mode_top10_draft,
    "cockpit-refresh": mode_cockpit_refresh,
    "reconcile": mode_reconcile,
    "run": mode_run,
    "universe": mode_universe,
    "features": mode_features,
    "backtest": mode_backtest,
    "intraday-probe": mode_intraday_probe,
}


# Which live modes are bound to the Tadawul calendar, and under which of
# session_gate's windows. Research and manual modes are deliberately absent:
# you must be able to run a backtest or a smoke test on a Friday.
GATED_MODES = {"digest": "digest", "digest-guard": "digest-backstop",
               "run": "session", "reconcile": "reconcile"}
MAX_SCHEDULE_LAG = {"digest": timedelta(minutes=60), "reconcile": timedelta(minutes=60)}
# digest-guard is deliberately absent from both the lag table and the "digest"
# window: it exists to run late. Gating it on the pre-open hour left it 50
# minutes of headroom against the 35-59 minute drift it was built to absorb, so
# on the worst day -- the 05:30 trigger dropped AND the 06:10 one delayed -- the
# backstop declined silently and no digest shipped at all.


def _scheduled_time(value: str | datetime | None) -> datetime | None:
    """Parse the workflow's intended UTC timestamp, never treating manual as a time."""
    if value is None or value == "manual":
        return None
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def gate_or_none(mode: str, *, now: datetime | None = None,
                 scheduled_for: str | datetime | None = None) -> str | None:
    """Why `mode` must not run right now, or None to proceed.

    session_gate.py has been complete, tested and dependency-free since it was
    written -- and imported only by runtime/job.py, the Cloud Run job that was
    never provisioned. The GitHub path, which is the one that actually runs,
    had no session gate and no holiday gate at all: it relied entirely on cron
    day-of-week. That is fine for weekends and wrong for Eid, where the
    schedule fires into a closed market and the digest reports stale bars as
    though they were this morning's.

    market_holidays.json currently records no closures, so this changes nothing
    until dates are added to it -- but the wiring has to exist first, otherwise
    adding them does nothing either.
    """
    window = GATED_MODES.get(mode)
    if window is None:
        return None
    # A manual dispatch is an explicit operator recovery action. Scheduled jobs
    # are judged by their intended market window, not a delayed Actions runner.
    if scheduled_for == "manual":
        return None
    intended = _scheduled_time(scheduled_for)
    return session_gate.gate_reason(window, now=intended or now)


def schedule_lateness_reason(mode: str, *, now: datetime | None = None,
                             scheduled_for: str | datetime | None = None) -> str | None:
    """Explain an intolerably delayed scheduled digest/reconciliation run."""
    intended = _scheduled_time(scheduled_for)
    maximum = MAX_SCHEDULE_LAG.get(mode)
    if intended is None or maximum is None:
        return None
    actual = now or datetime.now(timezone.utc)
    if actual.tzinfo is None:
        actual = actual.replace(tzinfo=timezone.utc)
    delay = actual.astimezone(timezone.utc) - intended
    if delay > maximum:
        return (f"scheduled {mode} is {int(delay.total_seconds() // 60)} minutes late "
                f"(maximum {int(maximum.total_seconds() // 60)} minutes)")
    return None


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

    now = datetime.now(timezone.utc)
    scheduled_for = os.environ.get("SCHEDULED_FOR")
    blocked = gate_or_none(mode, now=now, scheduled_for=scheduled_for)
    if blocked:
        # Exit 0, not a failure: a scheduled run landing on a closed market did
        # its job by declining. A non-zero here would fail the workflow step and
        # skip "Commit state" for the same reason a Discord outage used to.
        print(f"skipping '{mode}': {blocked}")
        return 0
    late = schedule_lateness_reason(mode, now=now, scheduled_for=scheduled_for)
    if late:
        # A late digest used to exit 1 and send nothing. That is the worst of
        # both worlds: the runner was already late, and the reader got silence
        # instead of a note that says so. Ship it, labelled -- the prices are
        # the previous close either way, and the label is what keeps that honest.
        global _LATE_WARNING
        # Mode-specific, because "the market may already be open" is true of a
        # late pre-open digest and false of a reconcile, which by definition
        # runs after the close. A warning the reader can check and find wrong
        # is worse than no warning.
        _LATE_WARNING = f"This {mode} ran late: {late}. Prices are the previous session's close."
        if mode.startswith("digest"):
            _LATE_WARNING += " The market may already be open."
        print(f"degraded '{mode}': {late}")
    return fn()


if __name__ == "__main__":
    raise SystemExit(main())
