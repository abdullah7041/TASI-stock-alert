"""
Discord delivery.

One HTTP POST to a webhook URL. No bot token, no server. The format function is
pure (testable offline); only send_discord touches the network.
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from email.utils import parsedate_to_datetime

import explain


COCKPIT_URL = "https://tasi-action-cockpit.busaud7041.chatgpt.site"


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


def build_dashboard_digest(snapshot: dict) -> str:
    """Render the persisted delayed dashboard summary for one routine digest."""
    summary = dict(snapshot.get("summaryV1") or {})
    cards = list(summary.get("cards") or [])
    if not cards:
        raise ValueError("dashboard summaryV1 cards are required for the daily digest")
    lines = [f"__**TASI delayed digest ({snapshot['tradeDate']})**__"]
    lines.extend(f"- {card['text']}" for card in cards)
    lateness = summary.get("latenessMinutes")
    if lateness:
        lines.append(f"- Digest started {lateness} minutes after its scheduled time.")
    return "\n".join(lines)


def _alert_company(alert: dict) -> str:
    """A stored alert from before names were required still has to read honestly."""
    return str(alert.get("name") or "").strip() or "Company name unavailable"


def build_movement_alert_message(alerts: list[dict], as_of: str) -> str:
    """Render one delayed-only Discord delivery for newly detected movements."""
    lines = [f"__**TASI unusual movement ({as_of})**__", "_Delayed analysis; verify live pricing in your broker app._"]
    for alert in sorted(alerts, key=lambda item: str(item.get("observedAt", ""))):
        # The numbers behind the alert. They were computed, stored in the
        # cockpit JSON, and then left out of the only surface anyone reads --
        # so the message said a name moved unusually without ever saying by
        # how much, which is not enough to act on or to dismiss.
        measures = []
        if alert.get("excessMovePct") is not None:
            measures.append(f"{float(alert['excessMovePct']):+.1f}% vs its own baseline")
        if alert.get("robustZ") is not None:
            measures.append(f"z {float(alert['robustZ']):.1f}")
        if alert.get("volumeRatio"):
            measures.append(f"volume {float(alert['volumeRatio']):.1f}x median")
        lines.append(f"**{_alert_company(alert)} ({alert['code']}) — {alert['direction']}**")
        if measures:
            lines.append(f"- {' · '.join(measures)}")
        lines.extend([
            f"- {alert['reason']}",
            f"- Observed {alert['observedAt']}; received {alert['receivedAt']}.",
        ])
    lines.append("Broker app owns real-time price alerts; this bot never places an order.")
    return "\n".join(lines)


# --- Rich embeds -----------------------------------------------------------
# Discord's documented hard limits. Exceeding any one of them rejects the whole
# request with a 400, which would look exactly like "the bot went quiet" -- the
# failure mode this repo already refuses everywhere else.
EMBED_TITLE_LIMIT = 256
EMBED_DESCRIPTION_LIMIT = 4096
EMBED_FIELD_NAME_LIMIT = 256
EMBED_FIELD_VALUE_LIMIT = 1024
EMBED_FIELDS_LIMIT = 25
EMBED_TOTAL_LIMIT = 6000
EMBEDS_PER_MESSAGE = 10

# Left bar colour. Carries no information the text does not also carry --
# colour alone is unreadable for a colour-blind reader and invisible in a
# notification preview.
COLOR_UP = 0x2ECC71
COLOR_DOWN = 0xE74C3C
COLOR_FLAT = 0x95A5A6
COLOR_ATTENTION = 0xE67E22


def _clip(text: str, limit: int) -> str:
    """Trim to a Discord limit, marking that trimming happened."""
    text = str(text)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _embed_size(embed: dict) -> int:
    """Character count Discord charges this embed against EMBED_TOTAL_LIMIT."""
    total = len(embed.get("title") or "") + len(embed.get("description") or "")
    total += len((embed.get("footer") or {}).get("text") or "")
    total += len((embed.get("author") or {}).get("name") or "")
    for field in embed.get("fields") or []:
        total += len(field.get("name") or "") + len(field.get("value") or "")
    return total


def pack_embeds(embeds: list, per_message: int = EMBEDS_PER_MESSAGE,
                total_limit: int = EMBED_TOTAL_LIMIT) -> list:
    """Split embeds into Discord-sized message batches.

    Separate from pack_discord_content because the two carry different limits
    entirely: that one packs a single `content` string at 1900 chars, this one
    packs a list at 10 embeds AND 6000 aggregate characters per message. Using
    the content packer for embeds silently overflows the second limit.

    A single embed that is itself over the aggregate limit is still emitted, in
    a message of its own: dropping it would be a silent data loss, and
    build_name_embed already clips every field to keep that from happening.
    """
    if per_message < 1:
        raise ValueError("per_message must be positive")
    batches, current, current_size = [], [], 0
    for embed in embeds:
        size = _embed_size(embed)
        too_many = len(current) >= per_message
        too_big = current and (current_size + size) > total_limit
        if too_many or too_big:
            batches.append(current)
            current, current_size = [], 0
        current.append(embed)
        current_size += size
    if current:
        batches.append(current)
    return batches


def _field(name: str, value: str, inline: bool = False) -> dict:
    return {"name": _clip(name, EMBED_FIELD_NAME_LIMIT),
            "value": _clip(value, EMBED_FIELD_VALUE_LIMIT),
            "inline": inline}


def _fmt_volume(volume: dict | None) -> str:
    """Turnover against this name's own normal.

    The "not predictive" note is not boilerplate: docs/scanner-findings-
    2026-07-30.md measured this ratio against forward return and it failed, so
    the digest must never let it read as a buy signal. See analyze.volume_read.
    """
    if volume is None:
        return "not enough history to know this name's normal"
    ratio = volume["ratio"]
    window = volume["window"]
    if ratio >= 3.0:
        shape = f"**{ratio:.1f}x** its {window}-day median — heavy"
    elif ratio >= 2.0:
        shape = f"**{ratio:.1f}x** its {window}-day median — elevated"
    elif ratio <= 0.5:
        shape = f"{ratio:.1f}x its {window}-day median — thin"
    else:
        shape = f"{ratio:.1f}x its {window}-day median — normal"
    return f"{shape}\n_Observed, not predictive (measured: does not forecast return)._"


# Past this much drift from the price the levels were derived at, an ATR-scaled
# stop/target pair describes a different market than the one you are looking at.
# All 11 codes sit under 7% today, so this fires on neglect (autolevels not
# re-run) or a genuine repricing -- both of which you want told, not hidden
# behind a stop rendered as if it were still actionable.
LEVELS_STALE_DRIFT_PCT = 15.0


def _fmt_levels(levels: dict | None, price: float) -> str:
    """Stop / trim / target from levels.json, with distance from here.

    These have existed in levels.json for every code since autolevels first ran
    and have never once appeared in a Discord message.
    """
    if not levels:
        return "no derived levels yet (run `autolevels`)"
    parts = []
    for label in ("stop", "trim", "target"):
        value = levels.get(label)
        if value is None:
            continue
        away = (value - price) / price * 100 if price else 0.0
        parts.append(f"{label} {value:.2f} ({away:+.1f}%)")
    if not parts:
        return "no derived levels yet"
    line = " · ".join(parts)
    derived_at = levels.get("price_at_derivation")
    if derived_at and price:
        drift = (price - derived_at) / derived_at * 100
        if abs(drift) > LEVELS_STALE_DRIFT_PCT:
            line += (f"\n⚠ derived at {derived_at:.2f} — price has moved "
                     f"{drift:+.1f}% since; re-run `autolevels` before acting on these")
    return line


def _fmt_delta(delta: dict | None) -> str | None:
    """What actually changed since yesterday.

    history.compute_delta has computed this on every digest run for weeks;
    main._dashboard_snapshot hardcoded `"changed": []` and threw it away.
    """
    if delta is None:
        return "first recorded session for this name — no prior day to compare"
    bits = []
    if delta.get("rsi_delta") is not None:
        bits.append(f"RSI {delta['rsi_delta']:+.1f}")
    if delta.get("rules_met_delta"):
        bits.append(f"rules met {delta['rules_met_delta']:+d}")
    if delta.get("trend_flipped"):
        bits.append("**trend flipped**")
    for rule in delta.get("flipped") or []:
        bits.append(f"`{rule}` flipped")
    return " · ".join(bits) if bits else "nothing changed since yesterday"


def build_name_embed(rec: dict, *, levels: dict | None = None,
                     today: date | None = None, chart: str | None = None) -> dict:
    """One Discord embed for one name: the decision first, the numbers under it.

    This used to open with ten raw fields -- RSI, trend, two momentum windows,
    three price levels, a rules-met count -- and no sentence saying what to do
    or what would change it. Everything needed to write that sentence was
    already in `rec`; it was simply never assembled. So the decision now leads,
    and the same numbers follow underneath for whoever wants them. No value
    changed, and nothing new is fetched.

    Colour follows the DECISION, not the price. The left bar used to be green
    when a name rose yesterday and red when it fell, so a BUY on a down day
    showed red -- colour actively arguing against the call beside it. It is also
    never the only carrier: the verdict is the first word of the title.

    The three-way honesty rule from _fmt_news/_fmt_disclosures is preserved
    throughout: a failed fetch, an empty result, and real content must never
    render the same way.
    """
    current_day = today or date.today()
    delta = rec.get("delta")
    price = float(rec.get("price") or 0.0)

    label, tone = explain.verdict(rec)
    color = explain.TONE_COLORS[tone]

    move = explain.move_phrase(rec)
    title_move = f"  ({move})" if move else ""
    embed = {
        "title": _clip(f"{label} · {rec['code']} {rec['name']} — {price:.2f} SAR{title_move}",
                       EMBED_TITLE_LIMIT),
        "color": color,
        "fields": [],
    }

    # The decision, in three sentences: where you stand, what would move it,
    # and the engine's own stated reason.
    lines = [explain.situation(rec)]
    change = explain.what_would_change_it(rec, levels)
    if change:
        lines.append(change)
    reasons = rec.get("reason") or []
    if reasons:
        lines.append(f"_Why: {reasons[0]}_")
    embed["description"] = _clip("\n".join(lines), EMBED_DESCRIPTION_LIMIT)

    if rec.get("kind") == "watchlist":
        met, total = rec.get("rules_met"), rec.get("rules_total")
        if met is not None and total:
            embed["fields"].append(_field("Conditions", f"**{met}/{total}** met", inline=True))

    embed["fields"].append(_field("Volume", _fmt_volume(rec.get("volume")), inline=True))
    embed["fields"].append(_field("Your levels", _fmt_levels(levels, price)))
    embed["fields"].append(_field("The numbers", explain.numbers(rec)))

    # `_fmt_delta` renders "RSI +3.2 · rules met +1", which states a change in a
    # unit the reader would have to already understand to care about. Lead with
    # what it means; keep the raw deltas beside it for whoever reads them.
    changed = _fmt_delta(delta)
    plain_change = explain.changed_phrase(delta)
    if changed and changed not in (plain_change,):
        embed["fields"].append(_field("Since yesterday", f"{plain_change}\n_{changed}_"))
    else:
        embed["fields"].append(_field("Since yesterday", plain_change))

    if rec.get("kind") == "watchlist":
        sizing = rec.get("sizing")
        if sizing and not sizing.get("skip"):
            embed["fields"].append(_field(
                "Size", f"{sizing['shares']} sh x {price:.2f} = **{sizing['spend']} SAR** "
                        f"({sizing.get('budget_left_after')} SAR left this month)"))
        elif sizing and sizing.get("skip"):
            # A skipped buy must say WHY it was skipped and when that changes.
            # "no size" beside a qualifying name otherwise reads as the engine
            # disagreeing with its own call.
            embed["fields"].append(_field(
                "Size", f"Not sized — {sizing['skip']}."
                        + (f" Resets {explain.next_budget_reset()}."
                           if "budget" in sizing["skip"] else "")))

    news_lines = _fmt_news(rec.get("news") or {}, today=current_day)
    embed["fields"].append(_field(
        "News", "\n".join(line.strip() for line in news_lines) or "none"))

    disclosures = rec.get("disclosures")
    if disclosures:
        embed["fields"].append(_field(
            "Tadawul filings",
            "\n".join(line.strip() for line in _fmt_disclosures(disclosures))))

    lean = rec.get("lean")
    if lean and lean.get("unavailable"):
        # Three-way honesty again: a model that was not asked, a model that
        # failed, and a model that leaned neutral are three different things.
        # Rendering them alike is what made news look hardcoded (see _fmt_news).
        embed["fields"].append(_field(
            "Pre-open lean", f"unavailable — {lean['unavailable']}"))
    elif lean:
        drivers = lean.get("drivers") or []
        body = lean.get("take", "")
        if drivers:
            body += "\n" + " · ".join(f"`{d}`" for d in drivers)
        embed["fields"].append(_field(
            f"Pre-open lean — {lean.get('lean', 'unknown')} "
            f"({lean.get('confidence', 'unknown')} confidence)",
            f"{body}\n_Model judgement, not a validated forecast. Scored daily._"))

    if not rec.get("verified", True):
        embed["fields"].append(_field(
            "⚠ Symbol unverified",
            f"code {rec['code']} resolves to '{rec.get('yahoo_name') or 'no data'}' — "
            f"fix it in config.py"))

    if chart:
        embed["image"] = {"url": f"attachment://{chart}"}

    embed["fields"] = embed["fields"][:EMBED_FIELDS_LIMIT]
    return embed


def _section(title: str, subtitle: str) -> dict:
    """A visible divider between what you own and what you are watching."""
    return {"title": f"━━ {title} ━━", "color": COLOR_FLAT, "description": subtitle}


def build_digest_embeds(recs: list | None = None, *, regime: str | None = None,
                        trade_date: str | None = None, budget: dict | None = None,
                        levels_by_code: dict | None = None, warnings: list | None = None,
                        today: date | None = None, charts_by_code: dict | None = None,
                        early_movers: list | None = None,
                        index_unavailable: bool = False,
                        artifact: dict | None = None) -> list:
    """The pre-open digest as embeds: a header, then one embed per name.

    Replaces build_dashboard_digest's four-card message as the digest body.
    Holdings always appear -- you own them, so "nothing changed" is itself the
    answer you came for. Watchlist names appear when they are actionable or
    when something about them moved; the rest are named in one trailing line so
    a quiet name is visibly quiet rather than silently missing.
    """
    if artifact is not None:
        # The Discord view must not compose an independent truth.  The v3
        # artifact is also what the cockpit stores and renders.
        recs = artifact["digestRecords"]
        regime = artifact["regime"]
        trade_date = artifact["tradeDate"]
        budget = {"monthly_cap": artifact.get("monthlyBudgetSar")}
        warnings = artifact.get("warnings") or []
        early_movers = artifact.get("earlyMovers") or []
        index_unavailable = bool(artifact.get("indexUnavailable"))
        levels_by_code = {
            item["code"]: item.get("levels") or {}
            for item in artifact.get("charts") or []
            if item.get("status") == "available"
        }
    if recs is None or regime is None or trade_date is None:
        raise ValueError("Digest embeds require records, regime, and trade date.")
    early_movers = early_movers or []
    levels_by_code = levels_by_code or {}
    header_lines = [
        f"**Regime:** {regime}",
        f"[Open TASI Action Cockpit]({COCKPIT_URL})",
        "**Data:** delayed daily bars (free tier)",
    ]
    if budget:
        header_lines.append(
            f"**Budget:** {budget.get('allocated', 0)} SAR allocated of "
            f"{budget.get('budget', 0)} SAR remaining "
            f"(cap {budget.get('monthly_cap')} SAR/month)")
    for warning in warnings or []:
        header_lines.append(f"⚠ {warning}")

    header = {
        "title": _clip(f"TASI pre-open digest — {trade_date}", EMBED_TITLE_LIMIT),
        "color": COLOR_FLAT,
        "description": _clip("\n".join(header_lines), 4096),
    }

    holdings = [r for r in recs if r.get("kind") == "holding"]
    watch = [r for r in recs if r.get("kind") != "holding"]

    def _noteworthy(rec: dict) -> bool:
        if rec.get("action") not in ("WATCH", "HOLD"):
            return True
        if _is_changed(rec.get("delta")):
            return True
        if (rec.get("volume") or {}).get("unusual"):
            return True
        if _recent_headlines(rec.get("news") or {}, today or date.today()):
            return True
        return bool((rec.get("disclosures") or {}).get("items"))

    shown = [r for r in watch if _noteworthy(r)]
    quiet = [r for r in watch if r not in shown]

    charts_by_code = charts_by_code or {}

    def _named(rec: dict) -> dict:
        return build_name_embed(rec, levels=levels_by_code.get(rec["code"]),
                                today=today, chart=charts_by_code.get(rec["code"]))

    # Holdings and watchlist were already separated here, and rendered as
    # visually identical embeds -- so the split existed and the reader could not
    # see it. The only way to tell what you owned from what you were merely
    # watching was to notice which fields an embed happened to carry.
    embeds = [header]
    if holdings:
        embeds.append(_section(
            f"YOUR {len(holdings)} HOLDING" + ("S" if len(holdings) != 1 else ""),
                               "What you own. These appear every day, including "
                               "the days nothing happens to them."))
        embeds += [_named(rec) for rec in holdings]
    if shown:
        embeds.append(_section("WATCHING",
                               "Not owned. Listed here only when something about "
                               "them moved or they became actionable."))
        embeds += [_named(rec) for rec in shown]

    # The scanner covers ~265 names every morning. Until now `_scanner_block`
    # formatted it and nothing called that function, so the entire scan reached
    # the reader as a single integer in `researchCount`.
    if early_movers or index_unavailable:
        embeds.append(_section("EARLY MOVERS",
                               "Screened from ~265 Tadawul names this morning. "
                               "Not owned, not on your watchlist, not sized."))
        if index_unavailable:
            embeds.append({
                "color": COLOR_FLAT,
                "description": "⚠ The market index was unavailable this run, so "
                               "relative strength could not be computed for any "
                               "name. Anything below fired on the other condition "
                               "only.",
            })
        for entry in early_movers:
            embeds.append({
                "color": explain.TONE_COLORS[explain.WATCH],
                "description": _clip(
                    explain.early_mover_line(entry) + "\n"
                    + explain.early_mover_odds(entry), EMBED_DESCRIPTION_LIMIT),
            })
        embeds.append({"color": COLOR_FLAT,
                       "description": explain.EARLY_MOVERS_CAVEAT})

    embeds.append({
        "title": explain.LEGEND_TITLE,
        "color": COLOR_FLAT,
        "description": _clip("\n".join(explain.LEGEND_LINES), 4096),
    })

    footer_bits = []
    if quiet:
        footer_bits.append("Quiet on the watchlist: "
                           + ", ".join(f"{r['code']} {r['name']}" for r in quiet))
    footer_bits.append("Automates your rules. Not financial advice. You execute every trade.")
    embeds.append({"color": COLOR_FLAT,
                   "description": _clip("\n".join(footer_bits), 4096)})
    return embeds


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


def send_discord(content: str | None = None, webhook_url: str | None = None,
                 embeds: list | None = None, files: dict | None = None) -> bool:
    """POST to Discord. Returns True on 2xx. Never raises.

    `content` keeps the original plain-text behaviour byte for byte, so every
    existing caller is unaffected. `embeds` is the rich path: batched by
    pack_embeds (10 per message / 6000 chars), which is a different limit pair
    from the 1900-char content chunking and must not share that packer.

    When both are given the content rides on the first message only, so a
    header line is not repeated once per batch.
    """
    url = webhook_url or os.environ.get("DISCORD_WEBHOOK_URL")
    if not url:
        return False
    import requests

    payloads: list[dict] = []
    if embeds:
        batches = pack_embeds(embeds)
        for i, batch in enumerate(batches):
            payload = {"embeds": batch}
            if content and i == 0:
                payload["content"] = pack_discord_content(content)[0]
            payloads.append(payload)
    elif content is not None:
        # Discord caps content at 2000 chars; preserve semantic cards below it.
        payloads = [{"content": chunk} for chunk in pack_discord_content(content)]
    else:
        return False

    # Attachments ride the batch whose embeds reference them. Discord resolves
    # attachment://<name> only against files uploaded in the SAME request, so a
    # chart sent in a different message renders as a broken image.
    by_batch = _files_for_payloads(payloads, files or {})

    ok = True
    for payload, batch_files in zip(payloads, by_batch):
        try:
            if batch_files:
                r = requests.post(url, timeout=60, data={"payload_json": json.dumps(payload)},
                                  files={
                                      f"files[{i}]": (path.name, path.read_bytes(), "image/png")
                                      for i, path in enumerate(batch_files)
                                  })
            else:
                r = requests.post(url, json=payload, timeout=15)
            ok = ok and (200 <= r.status_code < 300)
        except Exception:
            ok = False
    return ok


def _files_for_payloads(payloads: list, files: dict) -> list:
    """Which uploads belong with which message, keyed by the embed image name.

    `files` maps a filename ("1303.png") to a Path. An embed asks for it via
    image.url == "attachment://1303.png". A file with no embed referencing it
    is dropped rather than uploaded as a bare attachment nothing points at.
    """
    out = []
    for payload in payloads:
        wanted = []
        for embed in payload.get("embeds") or []:
            ref = ((embed.get("image") or {}).get("url") or "")
            if ref.startswith("attachment://"):
                path = files.get(ref[len("attachment://"):])
                if path is not None:
                    wanted.append(path)
        out.append(wanted)
    return out
