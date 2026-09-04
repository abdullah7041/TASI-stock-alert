"""Plain English for the pre-open digest.

Why this module exists
----------------------
The engine computed all of this already and then printed it as
`RSI 47.2 · trend up · 10d -1.3% · 120d +8.4%` next to
`stop 13.95 (-7.5%) · trim 15.89 · target 16.59`. Ten raw fields, no verdict,
and nothing saying what to do or what would change it. Reading it required
knowing what RSI is; acting on it required knowing what the repo's own rules
were. That is a rendering problem, not an analysis problem -- so the fix lives
here, in rendering, and touches no number.

Three rules this module keeps
-----------------------------
1. **It invents nothing.** Every sentence is assembled from a field the record
   already carries. There is no new fetch, no new threshold, and no new score.
   In particular there is no "conviction" number: one was deleted for
   backtesting inverted against forward return, and a friendly wrapper around a
   number that does not work is still a number that does not work.
2. **Colour follows the decision, not the price.** The old left bar was green
   when a name rose yesterday and red when it fell, which meant a BUY on a down
   day showed red. Colour now says what to do; the text says it too, so colour
   is never the only carrier.
3. **"No data" and "nothing happened" are different.** They shared one grey
   before. They are separate states here, because a name whose data failed to
   arrive is not a name that sat still.
"""

from __future__ import annotations

from datetime import date

# --- tones ------------------------------------------------------------------
# Four states a reader can act on, and one for absent data. Deliberately fewer
# than the engine's action vocabulary: SELL (STOP) and SELL (TARGET) are the
# same instruction ("sell now") but opposite news, and that difference belongs
# in the sentence, not in a colour nobody can decode.
GOOD = "good"          # keep holding, or a fresh buy qualifies
WATCH = "watch"        # nothing to do today
ACT_GOOD = "act-good"  # act now, in profit -- target or trim reached
ACT_BAD = "act-bad"    # act now, protecting capital -- stop reached
NO_DATA = "no-data"

TONE_COLORS = {
    GOOD: 0x2ECC71,      # green
    WATCH: 0xF1C40F,     # yellow
    ACT_GOOD: 0xE67E22,  # orange
    ACT_BAD: 0xE74C3C,   # red
    NO_DATA: 0x95A5A6,   # grey
}

# action from analyze.py -> (what the reader should do, tone)
_VERDICTS = {
    "SELL (STOP)":   ("SELL NOW", ACT_BAD),
    "SELL (TARGET)": ("TAKE PROFIT", ACT_GOOD),
    "TRIM":          ("TAKE SOME PROFIT", ACT_GOOD),
    "HOLD":          ("KEEP", GOOD),
    "BUY":           ("BUY", GOOD),
    "WATCH":         ("WATCH", WATCH),
}

LEGEND_TITLE = "What the colours mean"
LEGEND_LINES = (
    "🟢 **Green — nothing to do, you're fine.** You own it and it's behaving, "
    "or a new name just qualified to buy.",
    "🟡 **Yellow — watching, no action.** On the list, not ready. The message "
    "says what would make it ready.",
    "🟠 **Orange — act, and it's good news.** Price reached your profit level.",
    "🔴 **Red — act, and it's protective.** Price reached your stop. This is the "
    "one that exists to cap a loss.",
    "⚪ **Grey — no data.** The price feed gave nothing usable for this name. "
    "It does not mean the name sat still; it means we cannot say.",
)


def _number(value) -> float | None:
    """Coerce to a real float, treating NaN and non-numbers as absent."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return None if result != result else result


def has_data(rec: dict) -> bool:
    """Whether this record carries a usable price. Grey depends only on this."""
    return _number(rec.get("price")) not in (None, 0.0)


def verdict(rec: dict) -> tuple[str, str]:
    """(what to do, tone). Never guesses: an unknown action stays unknown."""
    if not has_data(rec):
        return "NO DATA", NO_DATA
    label, tone = _VERDICTS.get(str(rec.get("action", "")), (None, None))
    if label is None:
        return str(rec.get("action") or "UNKNOWN"), WATCH
    return label, tone


def situation(rec: dict) -> str:
    """One sentence on where this name stands, in the reader's terms.

    For something owned that is profit or loss against real money. For something
    merely watched it is how close it is to qualifying -- said as a count, not
    as three rule names the reader would have to look up.
    """
    if rec.get("kind") == "holding":
        pnl = _number(rec.get("unrealized_pct"))
        if pnl is None:
            return ("Your profit or loss is unknown — this holding has no average "
                    "cost recorded.")
        if pnl > 0:
            return f"You're up {pnl:.1f}% on what you paid."
        if pnl < 0:
            return f"You're down {abs(pnl):.1f}% on what you paid."
        return "You're exactly level with what you paid."

    met, total = rec.get("rules_met"), rec.get("rules_total")
    if met is None or not total:
        return "Not enough history yet to judge this one."
    if met == total:
        return f"All {total} buy conditions are met."
    failing = [r for r in (rec.get("rules") or []) if not r.get("passed")]
    if len(failing) == 1:
        return (f"{met} of {total} buy conditions met. The one missing: "
                f"{_rule_phrase(failing[0])}.")
    return f"{met} of {total} buy conditions met."


_RULE_PHRASES = {
    "rsi_band": "it hasn't started recovering yet",
    "trend": "the price is still below its longer-term average",
    "momentum_floor": "it has fallen too far over the past six months",
}


def _rule_phrase(rule: dict) -> str:
    return _RULE_PHRASES.get(str(rule.get("rule")), str(rule.get("plain") or "unknown"))


def what_would_change_it(rec: dict, levels: dict | None) -> str | None:
    """The line that turns a verdict into something falsifiable tomorrow.

    This is the strongest thing the engine computes and it was the worst
    labelled: `triggers.py` solves for the exact close that flips a failing
    rule, and it was rendered as "Next-bar trigger" with the price stripped of
    any statement of what it would do.
    """
    if not has_data(rec):
        return None
    price = _number(rec.get("price")) or 0.0

    if rec.get("kind") == "holding":
        stop = _number((levels or {}).get("stop"))
        if stop is None or price <= 0:
            return None
        away = (stop - price) / price * 100
        if stop >= price:
            return f"It is already at or below your sell level of {stop:.2f}."
        return (f"It would take a fall to {stop:.2f} ({away:.1f}%) before this "
                f"becomes a sell.")

    reachable = [t for t in (rec.get("triggers") or []) if t.get("reachable")]
    if not reachable:
        if rec.get("triggers"):
            return ("Nothing it could plausibly do in one day would make it a buy.")
        return None
    nearest = min(reachable, key=lambda t: abs(t.get("pct_away") or 0.0))
    target = _number(nearest.get("trigger_price"))
    pct = _number(nearest.get("pct_away"))
    if target is None or pct is None:
        return None
    direction = "rise" if pct > 0 else "fall"
    return (f"A {direction} to {target:.2f} ({pct:+.1f}%) would be the next step "
            f"toward a buy.")


def move_phrase(rec: dict) -> str | None:
    """How it moved, labelled by WHEN -- never as 'today'.

    The digest runs before the open, so the newest daily bar is the previous
    session's close and its move is the previous session's move. It was rendered
    as "(+1.2% today)", which told the reader a number about a day that had not
    started yet.
    """
    move = _number((rec.get("delta") or {}).get("price_pct"))
    return None if move is None else f"{move:+.1f}% last session"


def numbers(rec: dict) -> str:
    """The technicals, said in words, on one line for whoever wants them."""
    long = rec.get("long_term") or {}
    short = rec.get("short_term") or {}
    bits = []

    rsi = _number(long.get("rsi"))
    if rsi is not None:
        if rsi >= 70:
            bits.append(f"looks overbought (RSI {rsi:.0f})")
        elif rsi <= 30:
            bits.append(f"looks oversold (RSI {rsi:.0f})")
        else:
            bits.append(f"neither overbought nor oversold (RSI {rsi:.0f})")

    trend = str(long.get("trend") or "")
    streak = rec.get("trend_streak") or {}
    phrase = {"up": "above its 50-day average",
              "down": "below its 50-day average",
              "flat": "sitting on its 50-day average"}.get(trend)
    if phrase:
        days = streak.get("days")
        bits.append(f"{phrase} for {days} days" if days else phrase)

    long_mom = _number(long.get("momentum_pct"))
    if long_mom is not None:
        bits.append(f"{long_mom:+.0f}% over six months")

    short_mom = _number(short.get("momentum_pct"))
    if short_mom is not None:
        bits.append(f"{short_mom:+.0f}% over ten days")

    # Volume is deliberately absent: it has its own field, and saying it twice
    # in one embed reads as two findings rather than one.

    return " · ".join(bits) if bits else "Not enough history to describe this one."


def changed_phrase(delta: dict | None) -> str:
    """What moved since yesterday, or a plain statement that nothing did."""
    if delta is None:
        return "First time we've recorded this name — nothing to compare against yet."
    if delta.get("trend_flipped"):
        return "Its trend flipped direction since yesterday."
    moved = delta.get("rules_met_delta") or 0
    if moved > 0:
        return f"It met {moved} more buy condition(s) than yesterday."
    if moved < 0:
        return f"It met {abs(moved)} fewer buy condition(s) than yesterday."
    return "Nothing changed since yesterday."


# --- early movers -----------------------------------------------------------
# Measured over 2021-2026 daily bars in docs/scanner-findings-2026-07-30.md.
# These are the only honest anchors this repo has for "is that a lot?", and
# until now they appeared solely in scanner.py's CLI output and the README --
# never next to a candidate the reader was actually looking at.
BASE_RATE_TOUCH_PCT = 27.97   # any intraday touch of +15% within 60 sessions
BASE_RATE_HELD_PCT = 12.85    # +15% still held at the 60-session mark
REL_STRENGTH_LIFT = 1.46      # top-decile relative strength, vs the touch rate


def early_mover_odds(entry: dict) -> str:
    """State a candidate's odds as a measured rate, never as a confidence.

    A rank with no base rate beside it is unreadable: "ranked 1st of 265" says
    nothing about whether that is worth acting on. This repo already measured
    the answer and then only ever printed it to a CLI nobody runs.
    """
    if entry.get("relativeStrengthMet"):
        lifted = BASE_RATE_TOUCH_PCT * REL_STRENGTH_LIFT
        return (f"Names with this much relative strength went on to touch +15% "
                f"within 60 sessions about {lifted:.0f}% of the time, against "
                f"{BASE_RATE_TOUCH_PCT:.0f}% for a name picked at random.")
    return (f"For reference, a randomly picked name touched +15% within 60 "
            f"sessions {BASE_RATE_TOUCH_PCT:.0f}% of the time.")


def early_mover_line(entry: dict) -> str:
    """One candidate, said plainly."""
    bits = []
    if entry.get("relativeStrengthMet"):
        bits.append(f"outperforming the market by {entry['relativeStrengthPct']:+.0f}% "
                    f"over three months")
    elif entry.get("relativeStrengthPct"):
        bits.append(f"{entry['relativeStrengthPct']:+.0f}% vs the market over three months")
    if entry.get("squeeze"):
        bits.append("unusually quiet lately, which sometimes precedes a move")
    detail = "; ".join(bits)
    if not detail:
        # The list is the top of a ranking, not a list of names that passed
        # something: it is filled to EARLY_MOVER_COUNT even when nothing
        # qualified, and when the index is missing NO name can be scored for
        # relative strength. Claiming a condition was met is the one thing this
        # line must not do.
        detail = ("met one screening condition" if entry.get("conditionsMet")
                  else "met no screening condition — it is here only as the top "
                       "of this morning's ranking")
    return (f"**{entry['code']} {entry['name']}** — {entry['price']:.2f} SAR\n"
            f"{detail[0].upper()}{detail[1:]}.")


EARLY_MOVERS_CAVEAT = (
    "_These are screening results, not recommendations, and nothing here is "
    "owned or sized. Two conditions are measured; the rest were tested and "
    "dropped for not working. You decide._"
)


def next_budget_reset(today: date | None = None) -> str:
    """When the monthly cap refills, said as a date rather than "next month".

    The budget is a fresh amount each calendar month; unspent does not carry.
    A reader told "no budget left" needs to know how long that lasts.
    """
    current = today or date.today()
    year, month = (current.year + 1, 1) if current.month == 12 else (current.year, current.month + 1)
    # Not strftime("%-d"): the no-pad flag is a glibc extension and raises
    # ValueError on Windows, which took the whole embed down on a local run.
    reset = date(year, month, 1)
    return f"{reset.day} {reset:%b}"
