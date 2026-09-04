# TASI Top 10 screening and alert standards research

Date: 2026-08-12

## Scope

This note records primary-source standards that can ground a 1–3 month TASI swing-opportunity screen and a fast-delayed unusual-movement alert. It does not select companies, set final weights, or constitute investment advice. Product decisions proposed for this repository are labelled separately from sourced standards.

## Source hierarchy and freshness

- Saudi Exchange describes itself as the official source of Saudi market information. Its issuer disclosures and financial statements therefore take priority over news summaries and third-party ratios. [Saudi Exchange market overview](https://www.saudiexchange.sa/wps/portal/saudiexchange/rules-guidance/capital-market-overview)
- Saudi Exchange states that interim reports are due within 30 days and annual reports within three months, while its current deadline page varies dates by fiscal year-end. The screen must store the reporting period, publication date, and observation date rather than treating a ratio as timeless. [Issuer disclosure overview](https://www.saudiexchange.sa/wps/portal/saudiexchange/rules-guidance/capital-market-overview/Restrictions-Periods-and-Financials-Deadline/%21ut/p/z0/04_Sj9CPykssy0xPLMnMz0vMAfIjo8ziTR3NDIw8LAz8_R0tzQ0C3byc3D19HI1NA831g0uK9AuyHRUBKJj7sQ%21%21/?uri=nm%3Aoid%3AZ6_5A602H80OOA970QFJBGILA3BN4), [current deadlines](https://www.saudiexchange.sa/wps/portal/saudiexchange/rules-guidance/capital-market-overview/Restrictions-Periods-and-Financials-Deadline)
- Saudi Exchange offers historical equities and index data and identifies financial statements, announcements, and corporate actions as separate data families. This supports point-in-time joins and prevents a later filing from leaking into an earlier score. [eReference Data](https://www.saudiexchange.sa/wps/portal/saudiexchange/trading/market-services/market-information-services/ereference-data)

## Company-direction standards

### Operating companies

Sourced standards:

- MSCI's quality approach uses high return on equity, stable earnings growth, and low financial leverage. [MSCI Quality Indexes](https://www.msci.com/indexes/group/quality-indexes)
- Gross profitability relative to assets is supported as a cross-sectional quality measure, including among large liquid stocks. [Novy-Marx, NBER Working Paper 15940](https://www.nber.org/papers/w15940)
- Earnings backed by cash flows deserve separate treatment from accrual-heavy earnings; Sloan found different persistence in the cash and accrual components. [Sloan 1996](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2598)

Proposed TASI gate:

- Require positive or improving profitability, cash conversion, and balance-sheet resilience. Compare year-over-year and trailing multi-period direction, not one isolated quarter.
- Treat valuation as context and downside risk, not proof that price will rise during a 1–3 month horizon.
- Flag auditor qualifications, restatements, related-party issues, sharp receivables/inventory growth, dilution, and cash/earnings divergence for human review.

### Banks

Sourced standards:

- IFRS 9 requires unbiased, probability-weighted expected-credit-loss estimates that reflect both loss and no-loss possibilities. [IFRS 9](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/)
- SAMA classifies performing and non-performing credit and requires monitoring of changes in loan-quality risk. Its financial-stability reporting assesses banking-sector resilience. [SAMA loan classification](https://rulebook.sama.gov.sa/en/14-assessment-and-classification-individual-loans), [SAMA Financial Stability Reports](https://www.sama.gov.sa/en-US/Publications/FinanceReports/pages/financialstability.aspx)

Proposed TASI gate:

- Replace ordinary-company debt and free-cash-flow rules with net profit/ROE direction, net interest and fee income direction, cost efficiency, asset-quality deterioration, impairment coverage, capital adequacy, liquidity, and financing/deposit growth quality.

### Insurers

Sourced standards:

- IFRS 17 separates insurance service performance from insurance finance results, recognizes service profit over coverage, and immediately recognizes loss-making groups. [IFRS 17 overview](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-17-insurance-contracts/)
- Saudi Arabia's Insurance Authority will move to a risk-based capital framework from 1 January 2027. [Insurance Authority announcement](https://www.ia.gov.sa/en/media-center/news/104)

Proposed TASI gate:

- Use insurance revenue and service-result direction, claims/service expense behavior, combined-ratio equivalents when consistently reported, contractual service margin direction, investment result quality, and solvency/capital resilience. Do not compare legacy premium measures mechanically with IFRS 17 insurance revenue.

### REITs

Sourced standards:

- CMA rules require complete, accurate, non-misleading fund disclosures on both the manager and Exchange websites. Saudi REITs are income-oriented funds governed separately from operating companies. [CMA Real Estate Investment Funds Regulations](https://cma.org.sa/en/RulesRegulations/Regulations/Documents/Real_Estate_Investment_Funds_Regulations_2025_EN.pdf)

Proposed TASI gate:

- Use occupancy, rental-income direction, funds-from-operations or a consistently derived cash proxy, distribution coverage, leverage and refinancing exposure, asset concentration, tenant concentration, related-party transactions, and discount/premium to reported NAV. Do not use ordinary-company revenue-growth and ROE rules unchanged.

## Swing-timing standards

Sourced standards:

- MSCI combines 6- and 12-month local price momentum, excludes the most recent month, adjusts momentum for volatility, and uses conditional review during volatility spikes. [MSCI Momentum Indexes Methodology](https://www.msci.com/indexes/documents/methodology/2_MSCI_Momentum_Indexes_Methodology_20250725.pdf)
- The repository's own TASI research found relative strength to survive its checks, ATR squeeze to be conditional, and raw volume surge alone to have no measurable signal in its sample. This local evidence must be revalidated out of sample before weight changes. [Local scanner findings](../scanner-findings-2026-07-30.md)

Proposed TASI gate:

- Rank only liquid, tradable names with sufficient history.
- Require positive relative strength versus TASI and sector, favorable risk-adjusted momentum/trend, and an executable volatility-based stop/target structure.
- Use volume/liquidity as confirmation and data-quality evidence, never as a standalone recommendation.
- Apply at most two Top 10 names per sector and controlled turnover: an incumbent leaves only for failed eligibility, material risk, or a challenger that clears a defined score buffer.

## Adaptive unusual-movement alerts

Sourced standards:

- High-frequency jump research compares discontinuous movement with locally estimated variation rather than relying only on a fixed percentage. Bipower-variation tests are a formal example. [Barndorff-Nielsen and Shephard](https://ora.ox.ac.uk/objects/uuid%3A69814686-bf28-49b0-981a-7a08317396b8)

Proposed TASI rule:

- Compute a robust standardized residual for each delayed observation after removing broad TASI and sector movement and scaling by the stock's own time-of-day volatility.
- A balanced alert requires both statistical unusualness and a material absolute move, plus acceptable liquidity/data freshness. Volume may strengthen confidence but cannot create the alert alone.
- Use separate meanings: downside alerts protect holdings; upside alerts flag acceleration in approved Top 10 names. Add cooldown, rearm/hysteresis, observed/source/received timestamps, and suppress when freshness cannot be verified.
- The broker app remains the real-time crossing layer. Discord is immediate delivery of the bot's delayed confirmation, and the site retains alert history.

## Target-before-stop forecast

Sourced standards:

- Probabilistic forecasts require calibration as well as discrimination; reliability diagrams and proper scores such as Brier score diagnose distinct properties. [Dimitriadis et al.](https://arxiv.org/abs/2301.10803)
- Proper forecast evaluation should compare against an appropriate base-rate forecast rather than interpret an absolute score without context. [Gneiting and Katzfuss](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2405902)

Proposed release gate:

- Define entry time, target, stop, maximum 60-session horizon, costs, corporate-action adjustment, and a conservative rule for a daily bar touching both boundaries.
- Train only on point-in-time data with rolling-origin splits and an embargo covering the outcome horizon.
- Publish no probability until an untouched evaluation set shows better Brier/log loss than the constant base rate, useful calibration, stable performance across periods/regimes, and adequate sample size. Otherwise show `forecast unavailable`.
- News and official disclosures begin as a dated catalyst/risk overlay. They enter the numerical model only after a point-in-time archive exists and incremental out-of-sample value is demonstrated.

## Refresh and governance proposal

- Daily after close: update market features and alert baselines.
- Weekly after Thursday close: produce an approval-gated Top 10 proposal with score/evidence/date changes.
- Event-driven: reassess after a material Saudi Exchange disclosure.
- Monthly: deep source review and data-quality audit.
- Quarterly/reporting-cycle: rebuild sector-specific fundamental direction after new statements.
- No list change reaches the site before explicit user approval; approved holdings may also occupy Top 10 slots and are labelled as owned.

