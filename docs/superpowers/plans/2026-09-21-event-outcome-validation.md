# Event outcome dataset and validation

Implements step 5 of the approved September 16 copilot design. Work is isolated
from OpenRouter PR #16. No probability is released merely by collecting data.

## Contract

- Keep source publication and first observation as separate timezone-aware times.
- An event becomes usable at the later timestamp; reject date-only legacy rows.
- Direct trusted-source URLs and an explicit stock symbol are required. Google
  RSS redirects and social posts remain discovery leads.
- Deduplicate by source URL and symbol, retaining the earliest observation.
- Measure the next available session open to the close after 1 and 5 sessions.
  These are daily observation windows, not intraday or causal estimates.
- Require complete windows and matched benchmark dates. Missing outcomes stay
  censored. Historical prices are labels only, never prediction inputs.
- Evaluate an expanding-window, smoothed event-class base-rate model against a
  training-only unconditional base rate. Purge training outcomes not yet known
  at the test decision time. Keep all stocks from one event together.
- Report counts, coverage, Brier/log loss, calibration, and explicit release
  blockers. No promotion without independent uncertainty, regime stability,
  survivorship coverage, and after-cost evidence.

## Implementation and verification

1. Add exact observation timestamps to future headline archive records.
2. Add an offline JSONL/JSON dataset and validation CLI with exclusions report.
3. Test delayed discovery, untrusted sources, incomplete windows, benchmark
   alignment, deduplication, and chronological train/test boundaries.
4. Make the existing release gate reject non-finite metrics.
5. Run repository Python checks and an audit of the real legacy news archive.

The stored archive cannot establish historical first-seen times retroactively.
The CLI therefore reports that coverage gap rather than backdating collection.
Intraday windows and no-news volume baselines require an archived bar history;
daily labels from this phase do not claim to implement those windows.
