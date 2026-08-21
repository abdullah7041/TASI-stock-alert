"""
The pre-open lean: a model reads the overnight picture and takes a position.

Why this exists at all
----------------------
`news.py` scores headlines with a keyword tally and says so plainly: it is
"the weakest, cheapest signal", it "gates nothing", and it cannot tell
"Enterprise" from "rise" without a word-boundary regex bolted on. It counts
words. It does not read.

Why it is allowed to state a lean
---------------------------------
This repo deleted a conviction score for backtesting inverted against forward
return (docs/backtest-findings-2026-07-23.md), and that judgement stands: no
unvalidated number may gate a BUY. Nothing here does. `buy_decision` never sees
this output, `allocate_budget` never sees it, and the scanner never ranks on
it. It is rendered in its own field, labelled as model judgement, and -- this
is the part that makes it honest rather than merely disclaimed -- every lean is
recorded and later graded against what the price actually did, so its hit rate
becomes a measured number instead of a claim. See `mode_reconcile`.

Failure is never silence
------------------------
Same three-way rule as `news._fmt_news` and `disclosures`: a failed call, a
skipped call, and a real answer must never render identically. A model outage
degrades the digest to facts-only with the reason named; it never produces a
neutral-looking lean that reads as "the model considered this and shrugged".
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

HERE = Path(__file__).parent
BUDGET_FILE = HERE / "llm_budget.json"

# Anthropic is chosen over the OpenAI integration already in the repo because
# that one lives in the Cloudflare Worker (app/lib/research-agent.ts) with its
# budget tracked in D1, which this Python producer cannot reach. A new secret
# and a separate ledger were needed either way, so the choice was free. Every
# call goes through `_complete` -- swapping vendors is a one-function change.
API_URL = "https://api.anthropic.com/v1/messages"
MODEL = os.environ.get("TASI_LLM_MODEL", "claude-sonnet-5")
API_VERSION = "2023-06-01"
MAX_TOKENS = 2000
MONTHLY_CALL_CAP = int(os.environ.get("TASI_LLM_MONTHLY_CALLS", "40"))

LEANS = ("positive", "negative", "neutral")
CONFIDENCES = ("low", "medium", "high")

SYSTEM = """You are a sell-side analyst writing a pre-open note on Saudi (Tadawul) equities.

You will be given, per company: recent price action, technical reads, how today's
turnover compares to that name's own recent median, derived stop/target levels,
recent headlines, and any Tadawul filings.

For each company return a short take and a directional lean for the coming
session. Rules:
- Ground every take in the specific evidence given. Name the driver.
- If the evidence is thin or mixed, say so and use "neutral" with low confidence.
  A neutral lean that names why is more useful than a guessed direction.
- Never invent a headline, a number, or a filing that is not in the input.
- Do not give investment advice or position sizing. Describe what you see and
  where you lean.
- Keep each take under 280 characters.

Return ONLY valid JSON, no prose around it, in exactly this shape:
{"takes":[{"code":"1303","lean":"positive|negative|neutral","confidence":"low|medium|high","take":"...","drivers":["..."]}]}"""


def _month() -> str:
    return time.strftime("%Y-%m")


def budget_state(path: Path | None = None) -> dict:
    source = path or BUDGET_FILE
    if not source.exists():
        return {"month": _month(), "calls": 0}
    try:
        state = json.loads(source.read_text(encoding="utf-8"))
    except ValueError:
        return {"month": _month(), "calls": 0}
    if state.get("month") != _month():
        return {"month": _month(), "calls": 0}
    return {"month": state["month"], "calls": int(state.get("calls", 0))}


def budget_remaining(path: Path | None = None, cap: int = MONTHLY_CALL_CAP) -> int:
    return max(0, cap - budget_state(path)["calls"])


def _record_call(path: Path | None = None) -> None:
    source = path or BUDGET_FILE
    state = budget_state(source)
    state["calls"] += 1
    source.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def build_prompt(recs: list) -> str:
    """One prompt covering every name, so the model sees them side by side.

    Cross-sectional context is most of the value: "the only one of your eleven
    on heavy volume" is a different statement from "on heavy volume".
    """
    blocks = []
    for rec in recs:
        short = rec.get("short_term") or {}
        long = rec.get("long_term") or {}
        volume = rec.get("volume")
        delta = rec.get("delta")
        lines = [
            f"## {rec['code']} {rec['name']}",
            f"- price: {rec.get('price')} SAR"
            + (f" ({delta['price_pct']:+.1f}% vs yesterday)"
               if delta and delta.get("price_pct") is not None else " (no prior close on file)"),
            f"- engine call: {rec.get('action')}"
            + (f" — {'; '.join(rec.get('reason') or [])}" if rec.get("reason") else ""),
            f"- technicals: RSI {long.get('rsi')}, trend {long.get('trend')}, "
            f"10-day momentum {short.get('momentum_pct')}%, 120-day {long.get('momentum_pct')}%",
        ]
        if volume:
            lines.append(f"- turnover: {volume['ratio']}x this name's own "
                         f"{volume['window']}-day median")
        else:
            lines.append("- turnover: not enough history to compare")

        news = rec.get("news") or {}
        if news.get("ok") is False:
            lines.append("- news: the fetch FAILED this run; absence of headlines "
                         "here is not evidence of quiet")
        else:
            headlines = news.get("headlines") or []
            if headlines:
                lines.append("- headlines:")
                lines += [f"    - \"{h.get('title', '')}\" ({h.get('published', '')})"
                          for h in headlines[:5]]
            else:
                lines.append("- news: fetched successfully, no headlines found")

        disclosures = rec.get("disclosures") or {}
        if disclosures.get("ok") is False:
            lines.append("- Tadawul filings: the fetch FAILED this run")
        else:
            items = disclosures.get("items") or []
            if items:
                lines.append("- Tadawul filings:")
                lines += [f"    - \"{i.get('title', '')}\" ({i.get('published', '')})"
                          for i in items[:3]]
            else:
                lines.append("- Tadawul filings: none found")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def parse_response(payload: str) -> dict:
    """Model text -> {code: take}. Unparseable output is an error, not a shrug.

    Rejects any lean or confidence outside the allowed vocabulary rather than
    passing an invented label through to the digest, where it would render as
    though the model had produced it deliberately.
    """
    text = (payload or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
    data = json.loads(text)
    out = {}
    for item in data.get("takes") or []:
        code = str(item.get("code") or "").strip()
        lean = str(item.get("lean") or "").strip().lower()
        confidence = str(item.get("confidence") or "").strip().lower()
        if not code or lean not in LEANS or confidence not in CONFIDENCES:
            continue
        out[code] = {
            "lean": lean,
            "confidence": confidence,
            "take": str(item.get("take") or "").strip()[:280],
            "drivers": [str(d) for d in (item.get("drivers") or [])][:4],
        }
    return out


def _complete(prompt: str, *, api_key: str, timeout: int = 60) -> str:
    """The only network call. Swap vendors here and nowhere else."""
    import requests

    response = requests.post(
        API_URL,
        headers={"x-api-key": api_key, "anthropic-version": API_VERSION,
                 "content-type": "application/json"},
        json={"model": MODEL, "max_tokens": MAX_TOKENS, "system": SYSTEM,
              "messages": [{"role": "user", "content": prompt}]},
        timeout=timeout,
    )
    response.raise_for_status()
    body = response.json()
    return "".join(part.get("text", "") for part in body.get("content", []))


def get_leans(recs: list, *, api_key: str | None = None,
              budget_path: Path | None = None) -> dict:
    """{code: take} plus a `_status` entry. Never raises.

    `_status` is not decoration. "no API key", "monthly cap reached" and "the
    call failed" are three different states, and the digest renders each one
    differently -- collapsing them into an empty dict is exactly the mistake
    _fmt_news documents having already been made once with news.
    """
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return {"_status": {"ok": False, "reason": "no ANTHROPIC_API_KEY configured"}}
    if not recs:
        return {"_status": {"ok": False, "reason": "no names to read"}}
    remaining = budget_remaining(budget_path)
    if remaining <= 0:
        return {"_status": {"ok": False,
                            "reason": f"monthly cap of {MONTHLY_CALL_CAP} model calls reached"}}
    try:
        raw = _complete(build_prompt(recs), api_key=key)
    except Exception as exc:
        return {"_status": {"ok": False, "reason": f"model call failed ({type(exc).__name__})"}}
    _record_call(budget_path)
    try:
        leans = parse_response(raw)
    except Exception as exc:
        return {"_status": {"ok": False,
                            "reason": f"model returned unparseable output ({type(exc).__name__})"}}
    if not leans:
        return {"_status": {"ok": False, "reason": "model returned no usable takes"}}
    leans["_status"] = {"ok": True, "model": MODEL, "calls_left": remaining - 1}
    return leans
