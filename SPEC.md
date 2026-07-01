# TASI Alert + Recommendation System — Build Spec (v0)

A personal automation that watches your TASI holdings and watchlist during the trading session and pushes you a recommendation (not just a price alert) when a stock hits a level worth acting on. Runs Sunday to Thursday, no laptop required.

This is the personal tool, built to validate the idea on your own money first. The product version, if it earns it, comes later.

---

## The problem this fixes

Your bank app alerts you when a price hits a number you set. It does not tell you what to do. You still have to open the app, read the chart, remember your plan, and decide under pressure. That is how you missed the drop: the alert was manual, the decision was manual, and you were not looking.

This system does the looking and the deciding for you, then hands you a clear call: buy / sell / hold, at what level, how much, and why.

---

## Data source decision: SAHMK

SAHMK is the right source. It is Tadawul-licensed, runs server-side over a REST API and SDK, and covers all 350+ TASI/Nomu companies. It removes the delayed-quote problem that burned your 2320 call — but only on the right plan. That detail matters, so here is the honest plan breakdown.

| Capability you need | Plan that gives it | Notes |
|---|---|---|
| Realtime prices (`data_mode=realtime`) | Starter (149 SAR/mo) and up | Free and default = 15-min delayed. Delayed is what cost you on 2320. |
| Bulk quotes (`/quotes/?symbols=...`) | Starter+ | One call for your whole portfolio + watchlist. |
| Daily OHLCV history (`/historical/`, 1d/1w/1m) | Starter+ | Enough to compute RSI and support/resistance myself. |
| Dividends, financials | Starter+ | For yield-while-you-wait and fundamentals. |
| AI Stock Events (news + sentiment, `/events/`) | **Pro (499 SAR/mo)** | This is your "news + prediction" feature. Pro only. |
| Pre-built technicals, fair value, analyst consensus | **Pro** | On Starter I calculate RSI/levels from raw history instead. |
| Server-side Event Rules + Webhooks + WebSocket | **Pro+** | Their servers push when a level hits. Pro only. On Starter I poll instead. |

Correction worth stating plainly: SAHMK's marketing page lists "Webhooks & Event Rules" under every tier. Their actual rate-limits table shows webhooks, event rules, and WebSocket are Pro and above. So the cheap plan cannot push alerts to you. The system polls SAHMK on a schedule instead, which works fine for session-level swing alerts.

**Recommendation: build and test on Free (0 SAR, 15-min delayed), run live on Starter (149 SAR/mo ≈ $40).** Add Pro later only if the AI news feature proves worth 3x the cost. Prices exclude 15% VAT. Limits: Starter = 5,000 requests/day, 100/min — far more than this tool needs.

Base URL: `https://app.sahmk.sa/api/v1` · Auth header: `X-API-Key` · Python SDK: `pip install sahmk`

---

## Architecture (no laptop on)

```
GitHub Actions cron  ──►  Python script  ──►  SAHMK REST API
(scheduled, free)         (analysis)          (prices + history)
                                │
                                ▼
                        Discord webhook  ──►  your phone / desktop
```

Three parts, all free to run except the SAHMK plan:

1. **GitHub Actions scheduled workflow** runs the script every ~10 minutes during the session. Cron runs on GitHub's servers, so your laptop stays off. Free for this volume.
2. **Python script** pulls quotes + recent history, compares against your rules, builds the recommendation.
3. **Discord webhook** delivers the message instantly. Even simpler than a bot: one HTTP POST to a webhook URL, no token to manage, no server. Free, works on phone and desktop.

Cron schedule: TASI trades 10:00–15:00 Riyadh = 07:00–12:00 UTC. The workflow runs `*/10 7-11 * * 0-4` (every 10 min, 07:00–11:59 UTC, Sunday–Thursday). Secrets (SAHMK key, Telegram token) live in GitHub Secrets. A small JSON state file, committed back by the run, prevents the same alert firing every 10 minutes.

Why GitHub Actions over a VPS: zero servers to maintain, zero cost, version-controlled, matches your "no infra before there's a reason" rule. One honest limitation below.

---

## What each alert contains

You picked all four. Here is where each comes from and how reliable it is.

**1. Action + levels.** Buy / sell / hold, with entry zone, stop, and target — the exact structure already in your `portfolio-decisions-2026-06-11.md` file. That file becomes the system's rulebook: the system reads your per-stock add zones, stops, and trim zones and watches for them. Highest reliability, because the levels are yours.

**2. Position sizing from cash.** When a buy triggers, the system tells you how many shares, given your cash and the risk rule below. Transparent math, no black box. The only runtime input is your current deployable cash; the rules are pre-set defaults you can override.

**Proposed default risk rule (tuned for a small account):**

| Rule | Default | Why |
|---|---|---|
| Max open positions | 4-5 | A small account spread across 10 names is commission drag and odd lots. Concentration is correct here. |
| Position size | 20-30% of deployable cash per new buy | Gives 4-5 meaningful positions, not 20 tiny ones. |
| Risk per trade | Stop placed at the technical invalidation, capped so a stop-out loses ~8-10% of that position (~2-3% of total capital) | Defines size from the stop, not guesswork. |
| Max single position | 35% of portfolio | No one name dominates. Matches your old 8313 logic. |
| Cash buffer | Keep 10-15% uninvested | Dry powder for opportunities; avoids being fully deployed into a falling market. |
| Commission floor | Skip a buy if round-trip commission > ~1% of the trade | Stops you nibbling tiny lots that bleed fees — your "small trims aren't worth it" rule, automated. |

These are defaults, not law. Change any number and the system follows it.

**3. Technical read.** RSI(14), nearest support/resistance from recent swing highs/lows, and trend — computed from SAHMK daily history. On Starter I calculate these; on Pro SAHMK returns them pre-built. Medium reliability: technicals confirm timing, they do not predict.

**4. News + prediction — dropped.** You cut this, correctly. It is the weakest signal and the most expensive (needs SAHMK Pro). Not in scope. Can revisit later if the rest proves its worth.

**Plus two senior-level additions (your "beyond the basics"):**

- **Market-regime filter (v0):** suppress buy signals when the TASI index itself is breaking down. Stops the system buying into a market-wide selloff. Low effort, high protection.
- **Conviction score (v0):** every alert gets a 0-100 score from trend strength, RSI, and distance to your level — so a strong setup reads differently from a marginal one at a glance.
- **Concentration guard (phase 2):** warn when a buy over-weights one stock or sector.
- **Rules backtest (pre-launch check):** test entry/exit levels on 1-2 years of history before trusting them live. Run once before go-live rather than as a standing feature.

The recommendation logic tiers conviction, respects your stops, does not chase extended moves, and flags what would change the view.

---

## "Threshold-triggered" — what it means

You asked. Two ways to get alerted:

- **Daily digest**: one message at a set time, every session, whether or not anything happened. Predictable. Can become noise you ignore.
- **Threshold-triggered**: a message *only* when a price crosses a level you care about — your 2320 breakout above 72.50, your 1303 add zone at 14.50–15.20, your 8313 stop below 143. Silent until something actionable happens. This is the direct fix for "I got shocked by a drop I didn't see."

**Recommended: both, layered.** One pre-open digest at 09:45 Riyadh (your holdings, key levels, any overnight news), then threshold pings through the session whenever a level hits. You wanted coverage from 10:00 to 14:55 — the threshold pings give you that without 30 redundant messages.

---

## Cost

| Item | Cost |
|---|---|
| SAHMK Free (build/test, delayed data) | 0 SAR |
| SAHMK Starter (live, realtime) | 149 SAR/mo + VAT (~$40) |
| SAHMK Pro (adds AI news + server-side rules) | 499 SAR/mo + VAT (~$133) |
| GitHub Actions | 0 SAR (within free tier) |
| Discord webhook | 0 SAR |

Start at 149/mo. Only go to Pro if the news feature earns it.

---

## Honest risks and limits

- **GitHub Actions cron is not second-accurate.** Scheduled runs can be delayed several minutes under GitHub load. For 10-minute swing checks this is fine. If you ever need real-time tick alerts, that means SAHMK Pro WebSocket plus a small always-on worker — more cost, more infra. Do not build that until you need it.
- **Recommendations are not advice.** The system automates *your* rules. It is not licensed financial advice and will not place orders. You execute every trade yourself.
- **Predictions are weak by nature.** News-based direction calls will carry explicit confidence labels. Treat them as one input, not a signal to act alone.
- **Data trust.** Every alert will show the quote timestamp and whether it is realtime or delayed, so you always know what you are acting on.
- **Dedup state.** If the committed state file ever desyncs, you could get a repeat alert. Low stakes, easy to reset.

---

## Build plan (phased)

**Phase 1 — core loop (the thing that works end-to-end).**
SAHMK Free key → pull your 3 holdings + watchlist → check against levels in your TASI file → Telegram alert on a hit → GitHub Actions schedule. Tested on delayed data, your real stocks. Ship this first.

**Phase 2 — make it live and smart.**
Flip to Starter realtime. Add RSI/support/resistance calc. Add position sizing from your cash + risk rules. Add the pre-open digest.

**Phase 3 — news (optional).**
Evaluate SAHMK Pro AI Events. Add sentiment-tagged news + confidence-labeled direction. Only if phases 1–2 prove the habit sticks.

---

## What I need from you to build Phase 1

1. **Watchlist**: done — 10 mid/small-cap names in `WATCHLIST-RESEARCH.md`.
2. **Risk rule**: done — defaults above. The one runtime input I need is your **deployable cash figure** (or a placeholder to start).
3. **Accounts**: you have GitHub + Discord. I'll need the **SAHMK Free API key** and your **Discord webhook URL** when we build.
4. Confirm: build Phase 1 on the **Free** plan first (delayed data, 0 SAR) to prove the pipeline, then flip to Starter? Recommended.

Give me those and I will build the working Phase 1.
