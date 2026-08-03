# TASI Action Cockpit design

## Goal

Replace the unreadable, one-way Discord digest with a private action-first web
application. Keep the existing deterministic Python decision engine; rebuild
its presentation, runtime state, portfolio interaction, and research surface.

## User experience

The home screen prioritizes urgent position actions, material holding changes,
and at most three fully qualified scanner opportunities. One-condition scanner
results remain in a research view and never appear as daily actions. Discord
delivers a concise alert with a deep link to the related action card.

The portfolio copilot can explain a decision and conduct on-demand research.
Research cites official disclosures first and links every factual claim. It
cannot change a deterministic recommendation, portfolio, or sizing directly.
When the user reports a sale, it creates an expiring proposal; the user must
confirm the quantity, execution price, fees, and time before an exactly-once
ledger transaction is recorded.

## Architecture

The existing indicators, analysis, levels, and scanner stay Python modules.
They produce structured decision snapshots rather than Discord text. A FastAPI
service will expose snapshots, scanner research, chat, proposals, and trade
confirmation. The responsive Sites-hosted Action Cockpit consumes this API.

Cloud Run will host the API and the existing Python job image. Cloud Scheduler
will run pre-open, fifteen-minute intraday holding checks, and post-close work
in Asia/Riyadh. Firestore will become the durable store for positions,
transactions, decisions, alerts, proposals, chat records, research cache,
forecasts, and job health. Google sign-in will be restricted to one allowlisted
email. Until the required Google Cloud project and secrets are supplied, the
Sites frontend is an explicitly labelled preview using deterministic fixtures.

## Forecast and sizing

Forecasts cover the scanner liquidity-eligible TASI universe, enter at the
next session open, and resolve target-first, stop-first, or neither over sixty
trading sessions. Target and stop use the existing 3-ATR and 1.5-ATR convention;
an ambiguous daily bar resolves pessimistically to stop-first.

The model work uses a constant-rate baseline, multinomial logistic regression,
and at most one constrained tree challenger. It uses point-in-time features,
rolling-origin splits, a sixty-session purge, a final untouched period,
calibration checks, and block-bootstrap uncertainty. Forecasts remain visibly
experimental until their historical gates pass; they never substitute a scanner
rank when unavailable.

Sizing is built in the first release but remains shadow-only until there are at
least 120 trading sessions, 300 matured forecasts across 50 symbols, improved
live Brier and log loss, calibration error no greater than five percentage
points, and positive after-cost expectancy with bootstrap support. Activation
is manual and reversible. Once active, forecast sizing may only reduce the
existing deterministic size: unavailable keeps it unchanged, nonpositive
expected return skips, uncertain positive return halves it, and a positive
lower uncertainty bound retains the base size.

## Safety and rollout

The broker remains the immediate stop/target safety layer. Every app action
names quote source, observed time, and delayed status. Stale or missing quotes
cannot create a new action. Chat/research failures cannot block deterministic
alerts. External research is untrusted input and cannot issue tools.

Delivery proceeds in four independently verifiable milestones: structured
engine contracts; the cockpit and confirmation-gated ledger; the forecast
pipeline and shadow display; then managed-scheduler cutover after five trading
sessions of parallel comparison. GitHub Actions remains CI and manual recovery
after scheduled work moves away from Git commits and cron.
