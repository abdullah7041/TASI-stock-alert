"""
Discord delivery.

One HTTP POST to a webhook URL. No bot token, no server. The format function is
pure (testable offline); only send_discord touches the network.
"""

from __future__ import annotations

import os


def _fmt_reads(rec: dict) -> str:
    s = rec.get("short_term", {})
    l = rec.get("long_term", {})
    short = f"short: mom {s.get('momentum_pct')}% RSI {s.get('rsi')}"
    long = f"long: {l.get('trend')} mom {l.get('momentum_pct')}% RSI {l.get('rsi')}"
    return f"{short}\n   {long}"


def _fmt_news(news: dict) -> list:
    """Three distinct renders: a failed fetch, a fetch that found nothing, and
    a fetch with real headlines. Collapsing the first two into one 'neutral
    0.0' line is exactly what made news look hardcoded."""
    if news.get("ok") is False:
        return ["   news: fetch failed"]
    headlines = news.get("headlines") or []
    if not headlines:
        return [f"   news: no headlines found ({news.get('label')}, score {news.get('score')})"]
    lines = [f"   news: {news.get('label')} (score {news.get('score')}, {len(headlines)} headlines)"]
    for h in headlines[:3]:
        title = h.get("title", "")
        published = h.get("published", "")
        lines.append(f"      \"{title}\" — {published}")
    return lines


def _fmt_trigger(triggers: list) -> str | None:
    """One line: the nearest reachable trigger, or an honest 'none within
    reach' if triggers exist but none are close enough to compute, or None
    if there's nothing failing to show (a BUY)."""
    if not triggers:
        return None
    reachable = [t for t in triggers if t.get("reachable")]
    if not reachable:
        return "   Trigger (next bar): none within reach"
    nearest = min(reachable, key=lambda t: abs(t["pct_away"]))
    return f"   Trigger (next bar): {nearest['plain']}"


def _ordinal(n: int) -> str:
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


_TREND_PHRASE = {"up": "above its 50-day average", "down": "below its 50-day average",
                 "flat": "near its 50-day average"}


def _fmt_trend_streak(streak: dict, trend: str) -> str:
    phrase = _TREND_PHRASE.get(trend, "trend unknown")
    return f"   Trend: {phrase}, {_ordinal(streak['days'])} day (flipped {streak['started']})"


def _is_changed(delta: dict | None) -> bool:
    if delta is None:
        return False
    return bool(delta["flipped"]) or (delta["rules_met_delta"] or 0) != 0 or delta["trend_flipped"]


def format_recommendation(rec: dict) -> str:
    """One block per name. Marks changed names with a leading arrow, shows
    the day-over-day price move in the header, and collapses names with no
    change and no news to one summary line -- attention goes to what's new."""
    delta = rec.get("delta")
    changed = _is_changed(delta)
    news_headlines = bool((rec.get("news") or {}).get("headlines"))
    collapse = (delta is not None) and (not changed) and (not news_headlines) and (rec["action"] in ("HOLD", "WATCH"))

    arrow = "▲ " if changed else ""
    price_suffix = ""
    if delta is not None and delta.get("price_pct") is not None:
        price_suffix = f" ({delta['price_pct']:+.1f}% today)"
    head = f"{arrow}**{rec['code']} {rec['name']}** @ {rec['price']}{price_suffix}  ->  **{rec['action']}**"
    lines = [head]

    streak = rec.get("trend_streak")
    trend = rec.get("long_term", {}).get("trend")
    streak_line = _fmt_trend_streak(streak, trend) if streak else None

    if collapse:
        news_note = "No news" if not rec.get("news") else _fmt_news(rec["news"])[0].strip()
        lines.append(f"{streak_line.strip()}. {news_note}." if streak_line else f"{news_note}.")
        if rec["kind"] == "holding" and rec.get("unrealized_pct") is not None:
            lines.append(f"   P/L: {rec['unrealized_pct']}%")
        return "\n".join(lines)

    for r in rec.get("reason", []):
        lines.append(f"   - {r}")
    if rec["kind"] == "holding" and rec.get("unrealized_pct") is not None:
        lines.append(f"   P/L: {rec['unrealized_pct']}%")
    if rec["kind"] == "watchlist":
        lines.append(f"   Rules met: {rec.get('rules_met')}/{rec.get('rules_total')}")
        trigger_line = _fmt_trigger(rec.get("triggers") or [])
        if trigger_line:
            lines.append(trigger_line)
        sz = rec.get("sizing")
        if sz and not sz.get("skip"):
            lines.append(
                f"   size: BUY {sz['shares']} sh x {rec['price']} = {sz['spend']} SAR "
                f"(equal weight across qualifying names; "
                f"{sz.get('budget_left_after')} SAR of monthly budget left after)")
        elif sz and sz.get("skip"):
            lines.append(f"   size: none — {sz['skip']}")
    if streak_line:
        lines.append(streak_line)
    if rec.get("news"):
        lines.extend(_fmt_news(rec["news"]))
    lines.append(f"   {_fmt_reads(rec)}")
    return "\n".join(lines)


def build_message(recs: list, header: str, quote_note: str = "",
                  budget: dict | None = None) -> str:
    """Full Discord message. Only includes actionable recs unless header says digest."""
    parts = [f"__**{header}**__"]
    if quote_note:
        parts.append(f"_{quote_note}_")
    if not recs:
        parts.append("No actionable levels hit this run.")
    else:
        parts += [format_recommendation(r) for r in recs]
    if budget is not None:
        parts.append(
            f"**Budget** (cap {budget.get('monthly_cap')} SAR/month): "
            f"{budget['allocated']} SAR allocated this run out of {budget['budget']} SAR "
            f"remaining; {budget['leftover']} SAR stays cash.")
        unver = budget.get("unverified") or []
        if unver:
            lines = ["**⚠ Unverified symbols — excluded from BUY. Fix the code in config.py against Tadawul:**"]
            for code, name, yahoo in unver:
                lines.append(f"   - {code} labeled '{name}' resolves to '{yahoo or 'no data'}'")
            parts.append("\n".join(lines))
    parts.append("\n_Automates your rules. Not financial advice. You execute every trade._")
    return "\n\n".join(parts)


def send_discord(content: str, webhook_url: str | None = None) -> bool:
    """POST to Discord. Returns True on 2xx. Never raises."""
    url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not url:
        return False
    import requests
    # Discord caps content at 2000 chars; chunk if needed.
    chunks = [content[i:i + 1900] for i in range(0, len(content), 1900)] or [content]
    ok = True
    for chunk in chunks:
        try:
            r = requests.post(url, json={"content": chunk}, timeout=15)
            ok = ok and (200 <= r.status_code < 300)
        except Exception:
            ok = False
    return ok
