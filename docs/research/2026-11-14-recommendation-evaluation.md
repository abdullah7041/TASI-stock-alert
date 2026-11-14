# Recommendation evaluation cases

Frozen before live model evaluation. No live results are recorded here. Dates below are simulated as-of dates unless actual reviewed records are supplied and identified. Use the previous completed market session for entry unless the case states otherwise. Use synthetic issuers and clearly labelled synthetic metric values; never mix them into the live portfolio. In each case supply the supporting and contrary facts, their publication times and the exact references expected in the output. Keep all other prerequisites satisfied unless the case removes them.

| Case | As of (Riyadh) | Input variation | Expected |
| --- | --- | --- | --- |
| A01 | 2026-10-22 | Non-held operating company; improved cash conversion, favorable reviewed comparison and qualifying entry | BUY |
| A02 | 2026-10-25 | Non-held bank; improved capital and asset quality, favorable reviewed valuation and qualifying entry | BUY |
| A03 | 2026-10-26 | Non-held insurer; improved service result and solvency, favorable reviewed valuation and qualifying entry | BUY |
| A04 | 2026-10-22 | Held operating company with supported existing case and qualifying valuation and entry | ADD |
| A05 | 2026-10-25 | Held bank with supported case; RSI exactly 25 and all other entry conditions pass | ADD |
| A06 | 2026-10-26 | Held insurer with supported case; RSI exactly 60 and momentum exactly −5%, with uptrend | ADD |
| A07 | 2026-10-22 | Held company case still supported; entry fails | HOLD |
| A08 | 2026-10-25 | Held company case still supported; current prices unavailable | HOLD |
| A09 | 2026-10-26 | Held company case still supported; valuation unfavorable despite qualifying entry | HOLD |
| A10 | 2026-10-22 | One operating-company ownership premise weakens; separately evidenced continuing demand supports residual case | REDUCE |
| A11 | 2026-10-25 | Bank asset quality weakens materially; capital and liquidity remain supported | REDUCE |
| A12 | 2026-10-26 | Insurer claims weaken; confirmed operating case has a separate supported service-income rationale | REDUCE |
| A13 | 2026-10-22 | Reviewed cash conversion contradicts the core ownership reason | SELL |
| A14 | 2026-10-25 | Reviewed disclosure confirms the exact previously confirmed reconsideration condition | SELL |
| A15 | 2026-10-26 | Confirmed case contradicted by reviewed solvency facts while market data is unavailable | SELL |
| A16 | 2026-10-22 | Non-held company supported; valuation unfavorable | WATCH |
| A17 | 2026-10-25 | Non-held company supported with favorable valuation; available entry conditions fail | WATCH |
| A18 | 2026-10-26 | Reviewed non-held company has material weakness; evidence supports a specific watch condition | WATCH |
| B01 | 2026-10-22 | No confirmed profile | Blocked without model call |
| B02 | 2026-10-22 | Held company has no case for current profile revision | Blocked without model call |
| B03 | 2026-10-22 | Official collection failed | Blocked; prior entry historical |
| B04 | 2026-10-22 | Collection receipt absent | Blocked; absence distinguished from successful empty |
| B05 | 2026-10-22 | Last collection predates the expected session | Blocked |
| B06 | 2026-10-22 | New title-only notice and no reviewed disposition | Blocked |
| B07 | 2026-10-22 | Missing required sector fact | Blocked |
| B08 | 2026-10-22 | Supported non-held case but unknown current entry | Blocked |
| B09 | 2026-10-22 | Conflicting reviewed facts with no resolution | Blocked interpretation |
| B10 | 2026-10-22 | Model returns a citation outside the evidence bundle | Reject response |
| B11 | 2026-10-22 | A newer case or sale appears while generation runs | Discard result as current |
| B12 | 2026-10-22 | Provider unavailable or budget exhausted | Explicit failure; preserve earlier history |

Run each case twice through the configured application model on a nonproduction owner. For cases intentionally blocked before generation, verify there is no provider call. Record the policy/model versions, exact input revisions, action, and pass/fail for each run. Inspect whether each citation actually supports its associated claim, including counter-evidence and the owner's reconsideration condition. Any unsupported claim or bypassed prerequisite blocks promotion. These are evidence and behavior checks, not a return backtest.
