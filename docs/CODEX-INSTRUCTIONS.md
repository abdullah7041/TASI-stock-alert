# Instructions for Codex — align the cockpit with the new producer

Written 2026-08-25, against branch `claude/stock-analysis-brainstorm-xov5iu`.

The Python producer has changed. This document is the work needed on the
Next.js/Cloudflare cockpit (`app/`, `worker/`, `db/`) to match it. Each task
states what is wrong now, what to build, and how to know it worked.

**Read this first:** several things here look like new features and are not.
The portfolio ledger, the trade-proposal engine and the scanner formatter were
all written, tested, and never called. Prefer connecting what exists over
writing something new, and check `git log` before assuming a thing is missing.

---

## Task 1 — Find out why ingest returns 400 and 401 (do this before anything else)

**Symptom.** In the scheduled workflow, `POST /api/dashboard/ingest` returns
**HTTP 400** and `POST /api/alerts/ingest` returns **HTTP 401**, on the same
day, with the same two tokens. Nothing has reached the cockpit for days.

**What that combination means.** Both routes check the identical secret:

```ts
if (request.headers.get("authorization") !== `Bearer ${env.DASHBOARD_INGEST_TOKEN}`)
  return Response.json({ error: "Unauthorized." }, { status: 401 });
```

One route getting past that check while the other rejects it is not possible
from a single deployment. **The deployed Worker is running different code than
this repository.** Treat that as the finding, not as a theory to test.

**Do:**

1. Redeploy the Worker from the current `main` and re-run
   `Manual operations → cockpit-refresh`. Confirm both routes return 2xx.
2. Verify `DASHBOARD_INGEST_TOKEN` in the Worker's environment matches the
   `COCKPIT_INGEST_TOKEN` repository secret exactly — no trailing newline.
3. The workflow now prints the response body before failing (it previously
   captured it into a shell variable that `set -e` aborted past, which is why
   every rejection read as a bare `exit code 22`). If a 400 survives the
   redeploy, its reason is in the job log — act on that text, do not guess.

**Done when** a scheduled `digest` run shows `HTTP 200` for both ingests.

---

## Task 2 — `GET /api/portfolio/current` (the producer is already calling this)

**The producer now reads the confirmed portfolio each run.** The workflow step
*Load the confirmed portfolio for producer* calls this route; on any failure it
writes no file and `main.py` falls back to `config.HOLDINGS`. **The route does
not exist yet.** Until it does, the fallback is silently doing all the work.

**Auth:** same pair as `/api/top10/current` — the `OAI-Sites-Authorization`
bypass header plus `Authorization: Bearer <DASHBOARD_INGEST_TOKEN>`. This is
called by a machine, not a signed-in browser, so it must **not** use
`getPrivateResearchContext` (that is the owner-session path used by
`/api/portfolio`).

**Response shape — this is a contract `main.py` parses today:**

```jsonc
{
  "view": {                          // exactly foldPortfolio()'s return value
    "cashSar": 148.2,
    "holdings": [
      { "code": "1303", "name": "EIC", "shares": 124,
        "avgCostSar": 12.84, "realisedSar": 0 }
    ],
    "contributionMonth": "2026-08",
    "confirmedAt": "2026-08-25T05:12:00Z"
  },
  "spentThisMonthSar": 320.5,        // sum of buy events in the CURRENT calendar month
  "month": "2026-08"                 // the month spentThisMonthSar covers
}
```

`spentThisMonthSar` must be **shares × price + fees for `kind: "buy"` events
whose `confirmedAt` falls in `month`**. Sells do not reduce it: the cap is on
new-buy spend, and selling something does not un-spend the money. `main.py`
ignores `spentThisMonthSar` when `month` is not the current month, so return
the real current month rather than back-filling.

**Done when** a digest run's `dashboard.json` shows a non-zero
`portfolio.cashSar` and holdings that match the ledger rather than `config.py`.

---

## Task 3 — "Record a trade" panel

This is the feature the whole ledger exists for, and the reason `config.py` has
been hand-edited until now.

**Backend already exists** — `POST /api/portfolio/events` → `PortfolioStore.append`.
Do not rebuild it. This is a form.

**Fields:** stock (a select over holdings ∪ watchlist ∪ free-text code), buy or
sell, whole shares, price in SAR, optional fees. Plus a separate **"Add cash"**
control writing a `contribution` event, and a **"Correct my cash"** control
writing a `cash_adjustment` (which requires a `reason` string — that is the
event kind built for *"I spent some of it outside the system"*).

**Rules that are not negotiable:**

- **Generate `operationId` client-side and send it with the submit.** Two front
  doors write this ledger (this panel and the Discord command in Task 4), so a
  double submit is a real scenario. `foldPortfolio` rejects a duplicate
  `operationId`; that is the protection, and it only works if the id is stable
  across a retry of the *same* submission. Do not generate it server-side.
- **Nothing auto-confirms.** Every event is something a human typed. The system
  still places no orders.
- Surface the resulting position and remaining budget after a successful write,
  so the user can see the effect without navigating away.

**Done when** recording 20 shares of 1303 at 14.80 makes the next digest show
124 shares at a blended average cost, and the month's remaining budget drop by
296 SAR.

---

## Task 4 — Discord slash commands

**Constraint, stated plainly:** the current Discord integration is a **one-way
webhook** (`notify.send_discord`). It can send and cannot read. Recording a
trade from Discord needs a registered Discord **application** with an
Interactions endpoint.

**It does not need new infrastructure.** A Discord Interactions endpoint is an
HTTP POST handler with an Ed25519 signature check, and it runs on the Worker
that already serves the site.

**Build:** `app/api/discord/interactions/route.ts`

- Verify the `X-Signature-Ed25519` and `X-Signature-Timestamp` headers against
  the application's public key. **Reject unverified requests with 401 before
  parsing the body.** Discord will not activate an endpoint that fails its
  verification probe, so implement `PING` → `PONG` (type 1 → type 1) first.
- Commands: `/bought <code> <shares> <price>`, `/sold <code> <shares> <price>`,
  `/budget <remaining>`, `/portfolio`.
- Each maps to the **same `PortfolioStore.append`** the web form calls. That
  shared write is what makes the two front doors consistent — do not add a
  second code path, and do not add a reconciliation step, because there is
  nothing to reconcile when both write one ledger.
- Derive `operationId` deterministically from the interaction id, so Discord's
  retries cannot double-count a trade.
- Reply in-channel with the resulting position and remaining budget.

**Secrets:** `DISCORD_APP_PUBLIC_KEY`, and the application/bot registration
pointed at the Worker route.

**Done when** `/bought 1303 20 14.80` produces the same ledger state as the web
form, and re-sending the identical interaction changes nothing.

---

## Task 5 — Rebuild the cockpit around the decision

The producer now sends plain-language verdicts and a colour scheme that follows
the decision rather than yesterday's price. The screen has not caught up.

### 5a. Your holdings go to the top

Currently they are buried inside a collapsed `StatusRow`, and a holding sitting
on plain `HOLD` renders **nothing at all** — only `snapshot.urgent` becomes a
card, and `urgent` excludes HOLD and WATCH. So on a normal day the user sees no
sign of what they own.

Put all holdings in the first section, each showing: verdict, shares, average
cost, current price, unrealised P/L, and the one-line reason. Every holding
every day, including the quiet ones — a quiet day on something you own is the
answer you came for, not a reason to hide it.

### 5b. Read the verdict from the artifact, do not recompute it

`dashboard.json.digestRecords` carries each record. The Discord side derives its
verdict through `explain.verdict()` in Python. **Do not reimplement that mapping
in TypeScript** — two implementations of one decision will diverge. Either read
the verdict from the record, or ask for it to be added to `digestRecords`
(preferred; say so and it will be added producer-side).

### 5c. A colour legend, visible without interaction

The producer now emits one (`explain.LEGEND_LINES`). The cockpit has none, and
its colours are currently meaningless: `.statusState` is amber unconditionally,
so amber is not a state, it is the colour of whatever string is passed.

Match the producer exactly: 🟢 keep/buy · 🟡 watching · 🟠 act, good news ·
🔴 act, protective · ⚪ no data.

### 5d. Early movers

`dashboard.json` now carries `earlyMovers` (up to 5) and `indexUnavailable`.
The parser currently drops both — add them to `parseDashboardSnapshot` and
render a section. **Every candidate must show its base rate**; the copy is in
`explain.early_mover_odds()` and the measured numbers are in
`docs/scanner-findings-2026-07-30.md`. A rank without a base rate is unreadable.

When `indexUnavailable` is true, say so — relative strength could not be
computed for any name, and that must not look like a quiet market.

### 5e. Four cosmetic bugs, all confirmed

- **P/L is always styled red**, even at +40%: `.loss strong { color: #ff9faa }`
  is applied regardless of sign (`ActionCockpit.tsx:222`).
- **The red alarm `.actionCard` is reused** for the neutral trade proposal and
  for the Top-10 approval panel, so a routine "Approve" panel renders as an
  alert.
- **`data-state="urgent" | "changed" | "qualified"`** are written in the TSX and
  **no CSS selector reads them**. Either style them or drop them; right now they
  imply a state system that does not exist.
- **The Arabic selector is dead.** `ResearchWorkspace.tsx` sends `language` in
  the POST body and `app/api/research/chat/route.ts` never reads it, so choosing
  Arabic silently does nothing. Either thread it through to
  `answerStockQuestion` or remove the control. Do not leave it lying.

### 5f. A status strip

One line each, answering: did today's digest arrive, did the AI produce a lean,
did Discord confirm delivery. `leanStatus` now carries an `attempts` array
naming every provider tried or skipped and why — surface that on hover or
expand, because "why was there no lean today" should be answerable from the
screen.

---

## Task 6 — Unblock the Top 10

**The Top 10 has been empty every day since it was built, and always will be
until this is done.** `main._evidence_top10` returns `None` unless
`research/evidence.json` exists, and **that file has never existed in this
repo's history**. So `entries` is always `[]`, the Approve button never renders
(it is gated on `entries.length > 0`), and `approved`/`rejected` are unreachable
states. The amber chip can only ever say `"evidence pending"`.

**Do:** extend `mode_research_evidence` (which already scrapes Saudi Exchange
filings every Wednesday into `research/evidence_queue.json`) to draft the graded
metrics `research/company_evidence.py` requires, using the provider chain in
`llm.py`. Write `research/evidence.json` with `status: "ai-drafted"`.

**Constraints:**

- Every metric needs a `source_url` that is **HTTPS and taken from the filing
  itself**. `company_evidence.py` enforces this; do not weaken it.
- **Keep the human gate.** Nothing auto-approves. `assertApprovableTop10`
  already refuses an empty list server-side — leave that in place.
- Fix two scoring bugs while in there: `research/top10.py:24` sets
  `quality = fundamental`, so 55 of 100 points are the same number counted
  twice; and `main.py:218` passes `incumbents=[]`, which makes the 5-point
  replacement buffer dead code.

---

## What NOT to do

- **Do not add a conviction or confidence score.** One existed, gated BUY and
  weighted the budget, and backtested *inverted* against forward return over
  3,733 events. It was deleted rather than tuned
  (`docs/backtest-findings-2026-07-23.md`). A prettier wrapper around a number
  that does not work is still a number that does not work.
- **Do not re-propose `vol_surge` or `dist_52w_high`** as scanner features. Both
  were measured and dropped; `dist_52w_high` failed *backwards* against its own
  hypothesis (`docs/scanner-findings-2026-07-30.md`).
- **Do not let the lean gate anything.** `buy_decision` takes only
  `(long_read, criteria)` and a test asserts that signature and the absence of
  `lean` in its source. That is deliberate.
- **Do not present the forecast as available.** `research/entry_forecast.py`
  gates on 8 validation conditions and there is no model behind it. Show the
  measured base rates instead — those are real.
- **Do not claim intraday.** `movement.py` runs its robust-z over **daily**
  returns while the workflow calls it every 15 minutes and labels the result
  `delayed-intraday`. Dispatch `MODE=intraday-probe` (built, never once run) to
  settle whether free Yahoo serves `.SR` intraday bars before building anything
  session-time on top of it.
