# TASI cockpit refresh

Approved in chat by the user's Implement instruction on 2026-10-14.

## Outcome

An English, portfolio-first dashboard with clean light cards, soft borders,
clear typography and restrained emerald accents, inspired by shadcn's dashboard.
Retain the existing React/CSS stack. Improve evidence and reviews, not investment
policies or trade recommendations.

## Requirements

- Apply quote-date freshness to holdings and watchlist, independently of artifact
  generation time. Publish optional expectedPriceDate from the producer's Riyadh
  trading/holiday calendar. Older artifacts remain readable.
- Separate setup required, current, stale, unavailable and successfully empty
  states. No zero decision count when company assessments or account setup are
  incomplete. Preserve original source dates and failed/empty/content distinctions.
- Four navigable views: Overview (brief, review queue, account summaries, holdings),
  Portfolio (manual account setup/activity/reconciliation/history), Research
  (watchlist, candidates, details, verified events, evidence review), Assistant
  (conversations and saved decision notes).
- Keep broker cash independent and ledger writes previewed/confirmed. Never infer
  opening balances, cost bases, fees, broker assignments or policy thresholds.
- Move charts and supporting detail behind company details. Historical movements
  stay in dated history. Remove duplicate summaries, empty main-screen panels,
  unsupported forecast UI and experimental pulse placeholders. Preserve stored
  data and offline validation infrastructure.
- Replace raw evidence JSON input with labeled fields for the existing validated
  record contract. Render account history as readable activity.
- Responsive, accessible controls: keyboard navigation, visible focus, dialogs,
  inline errors, loading/retry/success states and no mobile overflow.
- Discord: one daily message, target <=900 characters, date/data age, state,
  <=3 relevant changes and cockpit link. No routine per-stock embed/chart dump.
  Extra messages cover holdings/watchlist only, verified relevant events and
  critical data loss/recovery transitions, deduplicated. Observations never become
  buy/sell instructions. Preserve schedules, owner access and publication gates.
- Preserve unrelated work and generated root JSON. Prepare preview before a live
  release; use canonical Cloudflare deployment, retain ledger and rollback version.

## Acceptance

Regression cases: fresh artifact/stale quote, absent dates, no confirmed holdings
but usable watchlist quotes, holidays/weekends, incomplete accounts, historical
events, failed versus empty retrieval. Exercise all retained workflows, Discord
limits/dedup/parity, and desktop/mobile keyboard/click behavior. Run documented
Python/web checks and current CI producer-contract/research checks. Deployment,
fresh data ingestion and actual Discord delivery require separate verification.
