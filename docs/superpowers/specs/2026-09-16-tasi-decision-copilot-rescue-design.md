# TASI Decision Copilot Rescue Design

## Outcome

Turn the private TASI cockpit into the owner’s complete decision view while keeping Discord brief. The cockpit must show what is fresh, what is verified, what merely moved, and what remains unknown. The assistant may help the owner form and revise a decision, but it never sends an order and never saves a decision without explicit confirmation.

## Approved hierarchy

1. Freshness and market/portfolio status.
2. Verified news events and the observed reactions of related stocks.
3. Unexplained price/volume anomalies, kept separate from news events.
4. Holdings and research candidates.
5. A persistent assistant rail for questions and proposed decision notes.

The cockpit remains owner-only. It auto-detects Arabic or English and allows an explicit language toggle. Discord provides material summaries, questions, and confirmed decision saves; it does not reproduce the full dashboard.

## Evidence rules

- Official filings and trusted reporting may establish a verified event. Curated social accounts such as `@SenseiFund` and `@THEWOLFOFTASI` are discovery leads only and must be verified against a trusted source before they can become an event.
- Market reaction is measured separately from causation. The UI may state that a stock or basket moved after an event; it must not claim the event caused the move.
- An unusual move without timely verified news remains `unexplained`. If later news appears, retain both original timestamps and label the link as a possible later explanation.
- Price freshness is explicit. A failed fetch, a valid empty result, and real content never share the same presentation.
- Prediction probabilities remain unavailable until an out-of-sample validation beats the relevant base rate. Until then the product shows evidence, scenarios, invalidation conditions, and observed reaction windows only.

## Market horizons

- Immediate reaction: pre-open, open gap, 30 minutes, current/close, and up to five sessions.
- Swing thesis: one to three months, with evidence, conditions, and invalidation.
- Intraday data target: delayed by five to fifteen minutes. Broker/exchange apps remain the authority for execution and real-time prices.

## Decision workflow

The assistant answers from the current portfolio, latest saved market data, event evidence, anomaly evidence, and saved decisions. It may propose one of `WATCH`, `AVOID`, `HOLD`, `REDUCE`, or `RESEARCH_MORE`, always with conditions and an invalidation. A proposal is displayed as a draft. Only the owner’s explicit confirmation persists it. No code path places or simulates an order.

## Delivery sequence

1. Add a deterministic intelligence projection and the approved cockpit hierarchy using existing canonical snapshots and movement alerts.
2. Add a five-to-fifteen-minute market pulse artifact and D1 ingestion so prices and reaction windows can refresh independently from the daily digest.
3. Expand research chat into a portfolio-aware persistent assistant and add confirmation-gated decision notes.
4. Add Discord `ask` and decision-draft/confirm interactions using the same services.
5. Build the event outcome dataset and validation report; release probability output only if the gate passes.

## Non-goals

- Brokerage execution or automated trading.
- Calling a social post verified evidence.
- Presenting daily Yahoo data as live.
- Inventing a probability while the validation artifact is absent or fails its gate.
- Replacing the existing Python, Cloudflare Worker, D1, or Discord architecture.

