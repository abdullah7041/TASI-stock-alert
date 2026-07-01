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


def _levels_for(code: str) -> dict:
    stored = _load(LEVELS_FILE, {})
    if code in stored:
        return stored[code]
    return cfg.FALLBACK_LEVELS.get(code, {})


# --- modes -----------------------------------------------------------------
def mode_heartbeat() -> int:
    ok = nt.send_discord("TASI recommender is alive and watching. (heartbeat, no prices checked)")
    print("heartbeat sent:", ok)
    return 0 if ok else 1


def mode_suggest() -> int:
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
    regime = _regime()
    recs = []
    # Holdings.
    for h in cfg.HOLDINGS:
        df = _load_history(h["code"])
        if df.empty:
            continue
        price = float(df["Close"].iloc[-1])
        recs.append(az.evaluate_holding(h, price, df, _levels_for(h["code"]),
                                        cfg.HORIZON, cfg.TECH))
    # Watchlist.
    for w in cfg.WATCHLIST:
        df = _load_history(w["code"])
        if df.empty:
            continue
        price = float(df["Close"].iloc[-1])
        news = None
        if include_news:
            try:
                import news as newsmod
                news = newsmod.get_news(w["name"], w["code"])
            except Exception:
                news = None
        recs.append(az.evaluate_watchlist(w, price, df, _levels_for(w["code"]),
                                          regime, cfg.RISK, cfg.HORIZON, cfg.TECH, news))
    return regime, recs


def mode_digest() -> int:
    regime, recs = _collect_recs(include_news=True)
    msg = nt.build_message(recs, f"TASI pre-open digest ({_today()}) - regime: {regime}",
                           quote_note="Delayed/daily data. Long-term reads are the reliable ones.")
    ok = nt.send_discord(msg)
    print("digest sent:", ok, "| recs:", len(recs))
    return 0 if ok else 1


def mode_run() -> int:
    regime, recs = _collect_recs(include_news=False)
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
                               quote_note="Delayed/daily data. Verify the live price before acting.")
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
    mode = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("MODE", "run")).strip()
    fn = MODES.get(mode)
    if not fn:
        print(f"unknown mode '{mode}'. choose: {', '.join(MODES)}")
        return 2
    return fn()


if __name__ == "__main__":
    raise SystemExit(main())
