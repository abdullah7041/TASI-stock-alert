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

Why there is a provider chain
-----------------------------
On 2026-08-24 every lean read `model call failed (ClientError)` with httpStatus
404. Nothing was down and no quota was spent: Google had retired
`gemini-2.5-flash`, and this module named that model in a constant with no
retry, no second model and no second provider. A single string going stale took
the whole feature with it.

Two rules came out of that, and both are enforced below:

1. **No hardcoded model ID that can rot.** Gemini is addressed through the
   `gemini-flash-latest` alias, which Google hot-swaps to the current release.
   OpenRouter has no such alias, so its model is required from the environment
   and the provider is skipped -- loudly -- when it is unset. A stale constant
   is never allowed to be the thing that fails.
2. **One provider is not a plan.** Providers are tried in order and a fatal
   answer from one is a reason to ask the next, not a reason to give up. The
   status records every attempt, so "why is there no lean today" is answerable
   from the artifact alone.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

HERE = Path(__file__).parent
BUDGET_FILE = HERE / "llm_budget.json"

# The digest runs in Python, independently from the Cloudflare research helper,
# so it carries its own keys and its own provider order. Every provider-specific
# detail stays inside that provider's `_complete_*` function.
#
# Order is deliberate and overridable: OpenRouter first when it is configured
# (one API across many models, so a retirement is a string change rather than an
# outage), Gemini second because its free tier costs nothing to fall back to.
PROVIDER_ORDER = tuple(
    name.strip().lower()
    for name in os.environ.get("TASI_LLM_PROVIDERS", "openrouter,gemini").split(",")
    if name.strip()
)

# `gemini-flash-latest` is an alias Google hot-swaps to the current flash
# release. It is used instead of a pinned ID precisely because a pinned ID is
# what broke: `gemini-2.5-flash` began returning 404 while still being listed.
GEMINI_MODEL = os.environ.get("TASI_LLM_MODEL_GEMINI",
                              os.environ.get("TASI_LLM_MODEL", "gemini-flash-latest"))

# OpenRouter publishes no evergreen alias, so there is no safe default to hide
# behind. Unset means the provider is skipped with that stated as the reason --
# never a silent fallback to a name that may since have been retired.
OPENROUTER_MODEL = os.environ.get("TASI_LLM_MODEL_OPENROUTER", "").strip()
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

MAX_TOKENS = 2000
MONTHLY_CALL_CAP = int(os.environ.get("TASI_LLM_MONTHLY_CALLS", "40"))

# Retry only what a retry can fix. A 404 or a 401 means the request itself is
# wrong -- repeating it just wastes the digest's time before the fallback runs.
RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
MAX_ATTEMPTS = 2
BACKOFF_SECONDS = 2.0

LEANS = ("positive", "negative", "neutral")
CONFIDENCES = ("low", "medium", "high")
HTTP_ERROR_CATEGORIES = {
    400: "invalid_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    408: "timeout",
    429: "rate_limited",
}

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

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "takes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "lean": {"type": "string", "enum": list(LEANS)},
                    "confidence": {"type": "string", "enum": list(CONFIDENCES)},
                    "take": {"type": "string"},
                    "drivers": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["code", "lean", "confidence", "take", "drivers"],
            },
        },
    },
    "required": ["takes"],
}


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
    """Call Gemini once and return its structured JSON text.

    The SDK validates the response schema request; `parse_response` remains the
    second, local validation boundary before an answer reaches Discord.
    """
    from google import genai

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config={
            "system_instruction": SYSTEM,
            "max_output_tokens": MAX_TOKENS,
            "response_mime_type": "application/json",
            "response_json_schema": RESPONSE_SCHEMA,
            "http_options": {"timeout": timeout * 1000},
        },
    )
    return str(response.text or "")


class ProviderHTTPError(Exception):
    """A provider answered with an HTTP error. Carries the status for routing."""

    def __init__(self, status: int, provider: str):
        # Deliberately no provider body text: the message is rendered into the
        # digest and an upstream error string is not ours to republish.
        super().__init__(f"{provider} returned HTTP {status}")
        self.code = status


def _complete_openrouter(prompt: str, *, api_key: str, timeout: int = 60) -> str:
    """Call OpenRouter's OpenAI-compatible endpoint and return the JSON text."""
    import requests

    response = requests.post(
        OPENROUTER_URL,
        timeout=timeout,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # OpenRouter attributes traffic by these; harmless and polite.
            "HTTP-Referer": "https://github.com/abdullah7041/TASI-stock-alert",
            "X-Title": "TASI recommender",
        },
        json={
            "model": OPENROUTER_MODEL,
            "max_tokens": MAX_TOKENS,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": prompt},
            ],
        },
    )
    if not 200 <= response.status_code < 300:
        raise ProviderHTTPError(response.status_code, "openrouter")
    payload = response.json()
    return str((payload["choices"][0]["message"].get("content") or ""))


def _provider_plan(gemini_key: str | None) -> list[dict]:
    """Which providers can actually be called, in order, and why not otherwise.

    A provider that cannot run is not dropped silently -- it is carried with the
    reason attached, so the digest can say "OpenRouter: no model configured"
    instead of leaving the reader to guess why the fallback never happened.
    """
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    available = {
        "openrouter": {
            "name": "openrouter",
            "model": OPENROUTER_MODEL,
            "call": _complete_openrouter,
            "key": openrouter_key,
            "skip": (
                "no OPENROUTER_API_KEY configured" if not openrouter_key
                else "no TASI_LLM_MODEL_OPENROUTER configured" if not OPENROUTER_MODEL
                else None
            ),
        },
        "gemini": {
            "name": "gemini",
            "model": GEMINI_MODEL,
            "call": _complete,
            "key": gemini_key,
            "skip": None if gemini_key else "no GEMINI_API_KEY configured",
        },
    }
    return [available[name] for name in PROVIDER_ORDER if name in available]


def _call_with_retry(provider: dict, prompt: str) -> tuple[str | None, dict | None]:
    """Return (text, None) on success or (None, failure_status).

    Retries only statuses a retry can fix. A fatal answer returns immediately so
    the caller can move to the next provider while the digest is still warm.
    """
    last: dict = {}
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return provider["call"](prompt, api_key=provider["key"]), None
        except Exception as exc:
            last = _failure_status(exc, provider=provider["name"], model=provider["model"])
            status = last.get("httpStatus")
            retryable = status in RETRYABLE_STATUS or status is None
            if not retryable or attempt == MAX_ATTEMPTS:
                return None, last
            time.sleep(BACKOFF_SECONDS * attempt)
    return None, last


def _failure_status(exc: Exception, *, provider: str, model: str) -> dict:
    """Return diagnostics that help operations without exposing provider text."""
    status = {
        "ok": False,
        "provider": provider,
        "model": model,
        "reason": f"model call failed ({type(exc).__name__})",
        "errorType": type(exc).__name__,
        "errorCategory": "client_error",
    }
    value = getattr(exc, "code", None)
    if type(value) is not int:
        value = getattr(exc, "status_code", None)
    if type(value) is int and 400 <= value <= 599:
        status["httpStatus"] = value
        status["errorCategory"] = HTTP_ERROR_CATEGORIES.get(
            value, "upstream_error" if value >= 500 else "client_error"
        )
    return status


def get_leans(recs: list, *, api_key: str | None = None,
              budget_path: Path | None = None) -> dict:
    """{code: take} plus a `_status` entry. Never raises.

    `_status` is not decoration. "no API key", "monthly cap reached" and "the
    call failed" are three different states, and the digest renders each one
    differently -- collapsing them into an empty dict is exactly the mistake
    _fmt_news documents having already been made once with news.
    """
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not recs:
        return {"_status": {"ok": False, "reason": "no names to read"}}
    remaining = budget_remaining(budget_path)
    if remaining <= 0:
        return {"_status": {"ok": False,
                            "reason": f"monthly cap of {MONTHLY_CALL_CAP} model calls reached"}}

    plan = _provider_plan(key)
    if not plan:
        return {"_status": {"ok": False,
                            "reason": f"no known provider in TASI_LLM_PROVIDERS "
                                      f"({', '.join(PROVIDER_ORDER) or 'empty'})"}}

    prompt = build_prompt(recs)
    attempts: list[dict] = []
    last_failure: dict | None = None

    for provider in plan:
        if provider["skip"]:
            attempts.append({"provider": provider["name"], "reason": provider["skip"]})
            continue

        raw, failure = _call_with_retry(provider, prompt)
        if failure is not None:
            attempts.append({"provider": provider["name"], "reason": failure["reason"],
                             **({"httpStatus": failure["httpStatus"]} if "httpStatus" in failure else {})})
            last_failure = failure
            continue

        # The budget counts calls that reached a provider, answer usable or not.
        _record_call(budget_path)
        try:
            leans = parse_response(raw)
        except Exception as exc:
            reason = f"model returned unparseable output ({type(exc).__name__})"
            attempts.append({"provider": provider["name"], "reason": reason})
            last_failure = {"ok": False, "provider": provider["name"],
                            "model": provider["model"], "reason": reason}
            continue
        if not leans:
            reason = "model returned no usable takes"
            attempts.append({"provider": provider["name"], "reason": reason})
            last_failure = {"ok": False, "provider": provider["name"],
                            "model": provider["model"], "reason": reason}
            continue

        leans["_status"] = {
            "ok": True,
            "provider": provider["name"],
            "model": provider["model"],
            "calls_left": budget_remaining(budget_path),
            **({"attempts": attempts} if attempts else {}),
        }
        return leans

    # Every provider is exhausted. Report the last real failure when there was
    # one; otherwise every provider was skipped and the reason is configuration.
    if last_failure is not None:
        return {"_status": {**last_failure, "attempts": attempts}}
    return {"_status": {
        "ok": False,
        "reason": "; ".join(f"{a['provider']}: {a['reason']}" for a in attempts)
                  or "no provider configured",
        "attempts": attempts,
    }}
