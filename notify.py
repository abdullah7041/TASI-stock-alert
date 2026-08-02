"""
Discord delivery.

One HTTP POST to a webhook URL. No bot token, no server. The format function is
pure (testable offline); only send_discord touches the network.
"""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime


def _fmt_reads(rec: dict) -> str:
    s = rec.get("short_term", {})
    l = rec.get("long_term", {})
    short = f"short: mom {s.get('momentum_pct')}% RSI {s.get('rsi')}"
    long = f"long: {l.get('trend')} mom {l.get('momentum_pct')}% RSI {l.get('rsi')}"
    return f"{short}\n   {long}"


def _headline_date(headline: dict) -> date | None:
    """Return a provider-supplied publication date, or None when it is unusable."""
    published = headline.get("published")
    if not isinstance(published, str) or not published.strip():
        return None
    try:
        return parsedate_to_datetime(published).date()
    except (TypeError, ValueError, IndexError):
        try:
            return datetime.fromisoformat(published.replace("Z", "+00:00")).date()
        except ValueError:
            for fmt in ("%d %b %Y", "%Y-%m-%d"):
                try:
                    return datetime.strptime(published, fmt).date()
                except ValueError:
                    pass
            return None


def _recent_headlines(news: dict, today: date) -> list[dict]:
    """Keep only headlines whose provider timestamp proves they are recent."""
    cutoff = today - timedelta(days=7)
    return [
        headline for headline in (news.get("headlines") or [])
        if (published_on := _headline_date(headline)) is not None and published_on >= cutoff
    ]


def _fmt_news(news: dict, *, today: date | None = None) -> list:
    """Three distinct renders: a failed fetch, a fetch that found nothing, and
    a fetch with real headlines. Collapsing the first two into one 'neutral
    0.0' line is exactly what made news look hardcoded."""
    if news.get("ok") is False:
        return ["   news: fetch failed"]
    headlines = news.get("headlines") or []
    if not headlines:
        return [f"   news: no headlines found ({news.get('label')}, score {news.get('score')})"]
    recent = _recent_headlines(news, today or date.today())
    if not recent:
        return [f"   news: no recent headlines found ({news.get('label')}, score {news.get('score')})"]
    lines = [f"   news: {news.get('label')} (score {news.get('score')}, {len(recent)} headlines)"]
    for h in recent[:3]:
        title = h.get("title", "")
        published = h.get("published", "")
        lines.append(f"      \"{title}\" — {published}")
    return lines


def _fmt_disclosures(disclosures: dict) -> list:
    """Same three-way distinction as _fmt_news: a failed fetch, a fetch that
    found nothing for this name, and a fetch with real matches."""
    if disclosures.get("ok") is False:
        return ["   disclosures: fetch failed"]
    items = disclosures.get("items") or []
    if not items:
        return ["   disclosures: none found"]
    lines = [f"   disclosures: {len(items)} recent"]
    for it in items[:2]:
        lines.append(f"      \"{it.get('title', '')}\" — {it.get('published', '')}")
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


def format_recommendation(rec: dict, *, today: date | None = None) -> str:
    """One block per name. Marks changed names with a leading arrow, shows
    the day-over-day price move in the header, and collapses names with no
    change and no news to one summary line -- attention goes to what's new."""
    current_day = today or date.today()
    delta = rec.get("delta")
    changed = _is_changed(delta)
    news_headlines = bool(_recent_headlines(rec.get("news") or {}, current_day))
    disclosure_items = bool((rec.get("disclosures") or {}).get("items"))
    collapse = (delta is not None) and (not changed) and (not news_headlines) \
        and (not disclosure_items) and (rec["action"] in ("HOLD", "WATCH"))

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
        news_note = "No news" if not rec.get("news") else _fmt_news(rec["news"], today=current_day)[0].strip()
        disc = rec.get("disclosures")
        if disc and disc.get("ok") is False:
            news_note += "; disclosures fetch failed"
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
        lines.extend(_fmt_news(rec["news"], today=current_day))
    if rec.get("disclosures"):
        lines.extend(_fmt_disclosures(rec["disclosures"]))
    lines.append(f"   {_fmt_reads(rec)}")
    return "\n".join(lines)


def format_condition_text(c: dict) -> str:
    """Plain-language rendering of a scanner candidate's met conditions.

    The single shared implementation for both the digest (format_scanner_block,
    below) and scanner.py's own CLI output (scanner.main imports this) -- it
    used to be hand-duplicated in both modules, which let the same wrong-suffix
    bug ("1th percentile" instead of "1st") ship in both copies at once while
    a drift test comparing the two outputs stayed green. One implementation
    means one place left to get this right.
    """
    parts = []
    if c["rel_strength_met"]:
        parts.append(f"rel_strength {c['rel_strength']:+.1f}% vs index")
    if c["squeeze_met"]:
        pctile = int(round(c["atr_squeeze_pctile"] * 100))
        parts.append(f"ATR squeeze, {_ordinal(pctile)} percentile "
                     f"(vol {c['volatility_pct']:.2f}%)")
    return "; ".join(parts) if parts else "no condition fired"


def format_scanner_block(candidates: list, names: dict,
                         index_unavailable: bool = False) -> str:
    """Digest-level section (unlike everything else in this module, which
    renders one already-known name): ranks candidates across the ~265-name
    Tadawul universe rather than reporting on a holding or watchlist name.

    Same three-way-honesty rule as _fmt_news/_fmt_disclosures: a rank without
    its base rate is meaningless, so the header always names both measured
    base rates (see research/base_rate.py's base_rate_report docstring and
    scanner.py's own main() for this repo's established convention), and an
    empty candidate list still prints the header plus an explicit 'no
    candidates today' -- never a silently omitted section, or a scanner
    outage looks identical to a quiet market.

    index_unavailable: True when the TASI index (^TASI.SR) had no usable
    data this run (matches the condition scanner.main() already checks
    before printing its own CLI warning). When true, rel_strength could not
    be computed for ANY candidate this run, so only the squeeze condition
    could have fired -- a degraded run that must not read identically to a
    normal one where rel_strength was simply not met. This is not
    hypothetical: it happened in a real live run (a tz-aware/tz-naive
    mismatch on ^TASI.SR's fallback path, see scanner._scan_all's docstring).
    """
    lines = [
        "**Scanner** — top breakout candidates from ~265 names "
        "(base rate 27.97% max-touch / 12.85% held-to-close)"
    ]
    if index_unavailable:
        lines.append(
            "   ⚠ index (^TASI.SR) unavailable this run — rel_strength could "
            "not be computed, so only the squeeze condition could fire below"
        )
    if not candidates:
        lines.append("   no candidates today")
    else:
        for c in candidates:
            name = names.get(c["code"]) or c["code"]
            lines.append(
                f"   {c['code']} {name}  @ {c['price']:.2f}   "
                f"{c['conditions_met']}/2 — {format_condition_text(c)}"
            )
    lines.append(
        "_Ranked candidates, not recommendations. Two features, both measured "
        "this session — see docs/scanner-findings-2026-07-30.md. You decide._"
    )
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


def pack_discord_content(content: str, limit: int = 1900) -> list[str]:
    """Pack complete digest cards into Discord-sized messages.

    Cards are separated by blank lines. A card that is itself too large is
    split only between lines, falling back to a whitespace boundary for a
    single overlong line. A token longer than Discord's cap is the sole case
    that must be split inside the token to keep every request valid.
    """
    if limit < 1:
        raise ValueError("limit must be positive")

    cards = [card for card in content.split("\n\n") if card]
    chunks: list[str] = []
    current = ""

    def append(piece: str) -> None:
        nonlocal current
        separator = "\n\n" if current else ""
        if current and len(current) + len(separator) + len(piece) > limit:
            chunks.append(current)
            current = piece
        else:
            current += separator + piece

    for card in cards:
        if len(card) <= limit:
            append(card)
            continue
        for line in card.splitlines():
            if len(line) <= limit:
                append(line)
                continue
            words = line.split()
            line_chunk = ""
            for word in words:
                if len(word) > limit:
                    if line_chunk:
                        append(line_chunk)
                        line_chunk = ""
                    for start in range(0, len(word), limit):
                        append(word[start:start + limit])
                    continue
                if line_chunk and len(line_chunk) + 1 + len(word) > limit:
                    append(line_chunk)
                    line_chunk = word
                else:
                    line_chunk = f"{line_chunk} {word}".strip()
            if line_chunk:
                append(line_chunk)
    if current or not chunks:
        chunks.append(current)
    return chunks


def send_discord(content: str, webhook_url: str | None = None) -> bool:
    """POST to Discord. Returns True on 2xx. Never raises."""
    url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not url:
        return False
    import requests
    # Discord caps content at 2000 chars; preserve semantic cards below it.
    chunks = pack_discord_content(content)
    ok = True
    for chunk in chunks:
        try:
            r = requests.post(url, json={"content": chunk}, timeout=15)
            ok = ok and (200 <= r.status_code < 300)
        except Exception:
            ok = False
    return ok
