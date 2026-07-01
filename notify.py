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
    short = f"short: mom {s.get('momentum_pct')}% RSI {s.get('rsi')} ({s.get('confidence')} conf)"
    long = f"long: {l.get('trend')} mom {l.get('momentum_pct')}% RSI {l.get('rsi')} ({l.get('confidence')} conf)"
    return f"{short}\n   {long}"


def format_recommendation(rec: dict) -> str:
    """One block per name."""
    head = f"**{rec['code']} {rec['name']}** @ {rec['price']}  ->  **{rec['action']}**"
    lines = [head]
    for r in rec.get("reason", []):
        lines.append(f"   - {r}")
    if rec["kind"] == "holding" and rec.get("unrealized_pct") is not None:
        lines.append(f"   P/L: {rec['unrealized_pct']}%")
    if rec["kind"] == "watchlist":
        lines.append(f"   conviction: {rec.get('conviction')}/100")
        if rec.get("sizing") and not rec["sizing"].get("skip"):
            sz = rec["sizing"]
            lines.append(f"   size: {sz['shares']} sh (~{sz['spend']} SAR, {sz['pct_of_cash']}% of cash)")
        if rec.get("news"):
            n = rec["news"]
            lines.append(f"   news: {n['label']} ({n['score']}, {n['count']} items, {n['confidence']} conf)")
    lines.append(f"   {_fmt_reads(rec)}")
    return "\n".join(lines)


def build_message(recs: list, header: str, quote_note: str = "") -> str:
    """Full Discord message. Only includes actionable recs unless header says digest."""
    parts = [f"__**{header}**__"]
    if quote_note:
        parts.append(f"_{quote_note}_")
    if not recs:
        parts.append("No actionable levels hit this run.")
    else:
        parts += [format_recommendation(r) for r in recs]
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
