# TASI Research Agent Lean Beta Design

## Purpose

Ship the useful first version quickly: private, on-demand research and chat for
scanner-qualified TASI ideas. It stays informational and never creates,
changes, sizes, or records a trade.

## Architecture

The existing private Sites deployment remains the only hosted application.
Vinext route handlers read Sites identity headers, enforce the configured owner
email, call the OpenAI Responses API with a server-side secret, and persist
short-lived report/thread/budget records in the Sites D1 binding `DB`.

There is no Cloud Run, FastAPI, Firestore, broker connection, automatic
research, or paid quote feed in this beta. The existing scanner remains the
source of deterministic technical setup and entry plan. The browser can supply
a temporary broker price only as clearly labelled context.

## Behaviour

- Only the existing qualified scanner cards can open Research.
- The workspace shows deterministic Technical Setup and Entry Plan immediately,
  then a cited Company & News/Risks summary created on demand.
- Reports are reused for the same user, symbol, and Riyadh trading date; an
  explicit refresh creates a new report only when budget remains.
- Chat is per stock and answers from the saved report, deterministic snapshot,
  and optional manual price. It does not perform new web searches.
- Research verdicts are `RESEARCH`, `WAIT`, or `SKIP`, never `BUY`.
- The server reserves a fixed bounded estimate before each new report or chat
  operation and stops at 45 SAR, leaving a 5 SAR margin under the 50 SAR goal.
- Report sources are official-first and reputable-news fallback. Citations come
  from OpenAI URL annotations and appear as clickable links.

## Failure and rollback

An unavailable D1 binding, missing secret, exhausted budget, invalid model
response, or search failure renders a visible agent error without hiding the
existing scanner. A single `VITE_AGENT_ENABLED=false` feature flag disables
the Research controls and restores the current cockpit immediately.
