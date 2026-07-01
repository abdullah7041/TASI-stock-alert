"""
TASI alert system - one run.
  python main.py              # normal run: check levels, send alerts
  python main.py --suggest    # print live price/RSI/support/resistance (no alerts)
  python main.py --autolevels # propose buy zones + stops/targets from live data -> levels.json
  python main.py --heartbeat  # send a 'system alive' ping to Discord

Levels come from levels.json (auto-derived, you approve) and fall back to config.py.
Secrets from env: SAHMK_API_KEY, DISCORD_WEBHOOK_URL. Optional: DATA_MODE=delayed|realtime.
"""
import os
import sys
import json
from datetime import date

import config as C
import analyze as A
from sahmk import Sahmk, SahmkError
import notify

HERE = os.path.dirname(__file__)
STATE_FILE = os.path.join(HERE, "state.json")
SYMBOLS_FILE = os.path.join(HERE, "symbols.json")
LEVELS_FILE = os.path.join(HERE, "levels.json")


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save_json(path, obj):
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)


def resolve_symbols(api):
    cache = load_json(SYMBOLS_FILE, {})
    changed = False
    for key, meta in {**C.HOLDINGS, **C.WATCHLIST}.items():
        if key in cache:
            continue
        cache[key] = key if key.isdigit() else api.resolve_symbol(meta["name"])
        if cache[key] is None:
            print(f"  ! could not resolve '{meta['name']}' ({key})")
        changed = True
    if changed:
        save_json(SYMBOLS_FILE, cache)
    return cache


def holding_level(levels, key, name):
    """levels.json value wins over config.py."""
    v = levels.get(key, {}).get(name)
    return v if v is not None else C.HOLDINGS[key].get(name)


def watch_zone(levels, key):
    v = levels.get(key, {}).get("buy_zone")
    if v is None:
        v = C.WATCHLIST[key].get("buy_zone")
    return tuple(v) if v else None


def already_alerted(state, key):
    return state.get(key) == date.today().isoformat()


def mark_alerted(state, key):
    state[key] = date.today().isoformat()


def run():
    mode = os.environ.get("DATA_MODE", "realtime")
    api = Sahmk(data_mode=mode)

    if "--heartbeat" in sys.argv:
        notify.send_text("TASI alert system is alive and watching. :white_check_mark:")
        return

    symbols = resolve_symbols(api)
    levels = load_json(LEVELS_FILE, {})
    state = load_json(STATE_FILE, {})

    summary = api.market_summary()
    ok_to_buy, regime_reason = A.regime_ok_for_buys(summary, [], C.REGIME)

    all_keys = {**C.HOLDINGS, **C.WATCHLIST}
    valid = {k: symbols[k] for k in all_keys if symbols.get(k)}
    qmap = api.quotes(list(valid.values()))

    suggest = "--suggest" in sys.argv
    autolevels = "--autolevels" in sys.argv
    lines, proposals, alerts = [], {}, []

    for key, meta in all_keys.items():
        sym = symbols.get(key)
        if not sym or sym not in qmap:
            continue
        q = qmap[sym]
        price = q.get("price")
        if price is None:
            continue
        closes = api.history_closes(sym, C.HISTORY_DAYS)
        rsi_val = A.rsi(closes, C.RSI_PERIOD) if closes else None
        support, resistance = A.support_resistance(closes, C.SR_LOOKBACK_DAYS) if closes else (None, None)
        is_holding = key in C.HOLDINGS

        if suggest:
            lines.append(f"{key} ({meta['name']}) sym={sym} price={price} RSI={rsi_val} "
                         f"support={support} resistance={resistance} delayed={q.get('is_delayed')}")
            continue

        if autolevels:
            kind = "holding" if is_holding else "watchlist"
            proposed = A.derive_levels(kind, price, support, resistance, C.RISK["stop_loss_pct"])
            if proposed:
                proposals[key] = proposed
                lines.append(f"{key} ({meta['name']}): {proposed}")
            else:
                lines.append(f"{key} ({meta['name']}): no history yet (Free tier?) - can't derive")
            continue

        if is_holding:
            h = C.HOLDINGS[key]
            for level_name, action in (("stop", "STOP"), ("trim", "TRIM"), ("target", "SELL")):
                lvl = holding_level(levels, key, level_name)
                if lvl is None:
                    continue
                hit = price <= lvl if level_name == "stop" else price >= lvl
                if not hit:
                    continue
                dkey = f"{sym}:{action}:{lvl}"
                if already_alerted(state, dkey):
                    continue
                pnl_pct = round((price - h["avg_cost"]) / h["avg_cost"] * 100, 1)
                alerts.append({"action": action, "symbol": sym, "name": meta["name"], "price": price,
                               "message": f"{action} level {lvl} hit at {price}.",
                               "fields": [("P&L", f"{pnl_pct}%"), ("Shares", h["shares"]),
                                          ("RSI", rsi_val), ("Delayed", q.get("is_delayed"))]})
                mark_alerted(state, dkey)
        else:
            zone = watch_zone(levels, key)
            if not zone:
                continue
            low, high = zone
            if not (low <= price <= high):
                continue
            if not ok_to_buy:
                dkey = f"{sym}:BUY_SUPPRESSED:{low}-{high}"
                if not already_alerted(state, dkey):
                    alerts.append({"action": "INFO", "symbol": sym, "name": meta["name"], "price": price,
                                   "message": f"In buy zone {low}-{high} at {price}, but BUY suppressed: {regime_reason}.",
                                   "fields": [("RSI", rsi_val)]})
                    mark_alerted(state, dkey)
                continue
            dkey = f"{sym}:BUY:{low}-{high}"
            if already_alerted(state, dkey):
                continue
            conv = A.conviction_score(price, rsi_val, closes, zone)
            size = A.position_size(price, C.RISK)
            fields = [("Conviction", f"{conv}/100" if conv is not None else "n/a"),
                      ("RSI", rsi_val), ("Support", support), ("Resistance", resistance)]
            if size.get("skip"):
                fields.append(("Sizing", size["skip"]))
            else:
                fields += [("Buy", f"{size['shares']} sh = {size['cost']} SAR"),
                           ("Stop", size["stop_price"]), ("Commission", size["commission_round_trip"])]
            alerts.append({"action": "BUY", "symbol": sym, "name": meta["name"], "price": price,
                           "message": f"In buy zone {low}-{high} at {price}.", "fields": fields})
            mark_alerted(state, dkey)

    if suggest:
        print(f"Regime: {'BUY-OK' if ok_to_buy else 'BUYS OFF'} ({regime_reason})")
        print("\n".join(lines) if lines else "no data (Free tier gives no history)")
        return

    if autolevels:
        if proposals:
            merged = {**levels, **proposals}
            save_json(LEVELS_FILE, merged)
            print("Proposed levels written to levels.json (review before relying on them):")
        print("\n".join(lines) if lines else "no history available - upgrade to Starter to auto-derive")
        return

    for a in alerts:
        try:
            notify.send(a)
            print(f"sent: {a['action']} {a['symbol']} @ {a['price']}")
        except Exception as e:
            print(f"FAILED to send {a['symbol']}: {e}")

    save_json(STATE_FILE, state)
    if not alerts:
        print(f"No alerts. Regime: {regime_reason}. Checked {len(valid)} names.")


if __name__ == "__main__":
    try:
        run()
    except SahmkError as e:
        print(f"SAHMK error: {e}")
        sys.exit(1)
