"""
Orchestration + CLI modes.

Modes (set via env MODE or first CLI arg):
  heartbeat  - send one "alive" ping to Discord. Tests secrets + webhook.
  suggest    - print raw price/RSI/support/resistance for every name. No alerts.
  autolevels - derive buy zones / stops / targets into levels.json. You review it.
  digest     - one pre-open summary of holdings + watchlist, sent to Discord.
  run        - the session job: check levels, send alerts on hits, dedup.

Run locally:  MODE=suggest python main.py
On GitHub Actions the workflow sets MODE.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import config as cfg
import data as dat
import analyze as az
import notify as nt
import indicators as ind

HERE = Path(__file__).parent
SYMBOLS_FILE = HERE / "symbols.json"
LEVELS_FILE = HERE / "levels.json"
STATE_FILE = HERE / "state.json"
BUDGET_FILE = HERE / "budget_state.json"


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


def _regime() -> str:
    idx = dat.get_index_history(cfg.REGIME["index_code"])
    return az.market_regime(idx, cfg.REGIME["index_ma"])


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


# --- modes -----------------------------------------------------------------
def mode_heartbeat() -> int:
    ok = nt.send_discord("TASI recommender is alive and watching. (heartbeat, no prices checked)")
    print("heartbeat sent:", ok)
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
        lv = az.derive_levels(df, cfg.TECH, cfg.RISK["stop_loss_pct"])
        out[code] = {**out.get(code, {}), **lv}
        print(f"{code} {item['name']}: {lv}")
    _save(LEVELS_FILE, out)
    print(f"\nWrote {LEVELS_FILE.name}. Review it, adjust any number, then run normally.")
    return 0


def _collect_recs(include_news: bool):
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
                return w["code"], None

        with ThreadPoolExecutor(max_workers=8) as ex:
            news_by_code = dict(ex.map(_fetch, cfg.WATCHLIST))

    unverified = []
    recs = []
    for h in cfg.HOLDINGS:
        df = hist.get(h["code"])
        if df is None or df.empty:
            continue
        price = float(df["Close"].iloc[-1])
        rec = az.evaluate_holding(h, price, df, _levels_for(h["code"], stored_levels),
                                  cfg.HORIZON, cfg.TECH)
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
        rec = az.evaluate_watchlist(w, price, df, _levels_for(w["code"], stored_levels),
                                    regime, cfg.RISK, cfg.HORIZON, cfg.TECH,
                                    news_by_code.get(w["code"]), cfg.BUY_CRITERIA)
        v = verify.get(w["code"], {})
        rec["verified"], rec["yahoo_name"] = v.get("verified", True), v.get("yahoo_name", "")
        if not rec["verified"]:
            # Unverified names cannot become BUY; excluded from the budget too.
            rec["action"] = "WATCH (UNVERIFIED)"
            rec["reason"] = [f"symbol UNVERIFIED: {v.get('reason')} — fix the code in config.py"]
            unverified.append((w["code"], w["name"], v.get("yahoo_name", "")))
        recs.append(rec)

    # Pool all BUYs (verified only — unverified were re-tagged above) and size
    # them from what is left of this month's budget.
    buys = [r for r in recs if r["action"] == "BUY"]
    budget_summary = az.allocate_budget(buys, _budget_remaining())
    budget_summary["monthly_cap"] = cfg.BUDGET["monthly_budget_sar"]
    budget_summary["unverified"] = unverified
    _budget_record(buys)
    return regime, recs, budget_summary


def mode_digest() -> int:
    regime, recs, budget = _collect_recs(include_news=True)
    msg = nt.build_message(recs, f"TASI pre-open digest ({_today()}) - regime: {regime}",
                           quote_note="Delayed/daily data. Long-term reads are the reliable ones.",
                           budget=budget)
    ok = nt.send_discord(msg)
    if not ok:
        print(msg)  # no webhook configured (e.g. local run) — show the digest here.
    print("digest sent:", ok, "| recs:", len(recs))
    return 0 if ok else 1


def mode_run() -> int:
    regime, recs, budget = _collect_recs(include_news=False)
    # Keep only actionable ones (a level was hit / BUY / SELL / TRIM).
    actionable = [r for r in recs if r["action"] not in ("HOLD", "WATCH")]

    state = _load(STATE_FILE, {})
    today = _today()
    fresh = []
    for r in actionable:
        key = f"{r['code']}:{r['action']}:{today}"
        if state.get(key):
            continue  # already alerted this level today.
        state[key] = int(time.time())
        fresh.append(r)

    if fresh:
        msg = nt.build_message(fresh, f"TASI alert ({today}) - regime: {regime}",
                               quote_note="Delayed/daily data. Verify the live price before acting.",
                               budget=budget)
        ok = nt.send_discord(msg)
        print("alert sent:", ok, "| fresh recs:", len(fresh))
    else:
        print("no fresh actionable recs; nothing sent.")

    # prune old state keys (keep today only).
    state = {k: v for k, v in state.items() if k.endswith(today)}
    _save(STATE_FILE, state)
    return 0


MODES = {
    "heartbeat": mode_heartbeat,
    "suggest": mode_suggest,
    "autolevels": mode_autolevels,
    "digest": mode_digest,
    "run": mode_run,
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
