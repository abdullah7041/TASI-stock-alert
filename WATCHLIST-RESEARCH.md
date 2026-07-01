# TASI Watchlist Research — Mid-Cap Growth + Momentum (6-12 month horizon)

Candidate shortlist for the alert system to track. Screen: growth + momentum, mid-cap sweet spot, Saudi main market. Research as of June 30, 2026.

**Read this first.** This is a candidate list built from public research and analyst coverage, not live data. I do not have your SAHMK key yet, so I have not verified current price, market cap, or momentum (RSI/trend) for any name. The system's first job on go-live is to pull live SAHMK data, confirm each symbol, drop anything that has run too far or broken down, and rank what's left by real momentum. Tickers marked "verify" need confirming against SAHMK's `/companies/` lookup before they go live. This is analysis, not financial advice — every decision stays yours, and your own rule applies: verify the live price before acting.

---

## Market backdrop (why timing matters)

TASI sits near 10,800, roughly 8-10% below its 2025 peak around 12,100. Year-to-date it's modestly positive. Two forces pull in opposite directions:

- **Tailwind:** In February 2026 the CMA removed the Qualified Foreign Investor restrictions, opening direct TASI access to any foreign investor. That can drive sustained foreign inflows into liquid growth names.
- **Overhang:** Regional conflict risk (Iran) is the live tail risk. An attack on Saudi infrastructure would sell off the whole index regardless of company fundamentals.

This is exactly why the **market-regime filter** earns its place in v0: when the index breaks down, individual buy signals get suppressed. You do not want the system telling you to buy a "good level" into a war-driven selloff.

Sectors with the strongest non-oil earnings growth right now: fintech, healthcare, logistics, and digital-government/IT. The shortlist tilts there.

Sources: [The Middle East Insider — Best Growth Stocks on Tadawul 2026](https://themiddleeastinsider.com/2026/03/23/best-growth-stocks-tadawul-saudi-arabia-2026/), [The Middle East Insider — TASI Analysis Mar 12 2026](https://themiddleeastinsider.com/2026/03/13/saudi-stock-market-tasi-analysis-march-12-2026/), [NAGA — Top Saudi Stocks June 2026](https://naga.com/en/academy/best-saudi-stocks).

---

## The shortlist (10 candidates)

Large-caps removed per your call. This is mid + small-cap only, non-oil growth, momentum-oriented. Target cap band SAR 5-40bn (the system enforces it on live data). Your holding Rasan (8313) is tracked separately as a position, so it's off the watchlist to keep the two lists distinct.

| # | Company | Ticker | Sector | Growth thesis (latest available) | Cap band | Key risk |
|---|---|---|---|---|---|---|
| 1 | Jamjoom Pharma | 4015 | Pharma | Revenue SAR 1.3bn 2024, +19.8% YoY; net margin 27%, EBITDA 33% | Mid | Generic-pricing pressure, input costs |
| 2 | Avalon Pharma | 4016 | Pharma / personal care | ~16% earnings CAGR est. 2025-27; derma + manufacturing scale-up | Small | Smaller float, execution on capacity |
| 3 | AJIL Financial Services | verify | Logistics / fleet finance | EPS +55% YoY; rides 34% Saudi e-commerce / last-mile growth | Small-mid | Credit cycle, rate sensitivity |
| 4 | Nupco | verify | Healthcare supply chain | Revenue +31% (2025); near-monopoly govt contracts, ~18x fwd P/E | Mid | Govt-pricing dependence, single-customer concentration |
| 5 | Nahdi Medical | 4164 (verify) | Healthcare retail / pharmacy | Revenue +18%, same-store +9%, private-label expansion, ~20x | Mid | Margin pressure, e-pharmacy competition |
| 6 | Jahez International | verify | Food delivery / logistics tech | Delivery + cloud-kitchen growth; non-oil consumer play | Small-mid | Thin margins, competition (HungerStation) |
| 7 | Lumi Rental | verify | Car rental / mobility | Vision 2030 tourism + mobility demand; fleet expansion | Mid | Capex-heavy, used-car residual values |
| 8 | SAL Saudi Logistics Services | verify | Air cargo / logistics | E-commerce + air-freight volume growth, hub buildout | Mid | Cyclical freight, customer concentration |
| 9 | Almoosa Health | verify | Healthcare / hospitals | 2025 IPO (SAR 127), strong debut; bed-capacity expansion | Small-mid | Newly listed, lock-up/volatility, single-region |
| 10 | Fakeeh Care Group | verify | Healthcare / hospitals | 2024 IPO (largest of the year); multi-hospital expansion | Mid | Execution on new hospitals, ramp costs |

Tickers: Jamjoom (4015) and Avalon (4016) confirmed from exchange/data sources. The rest are flagged "verify" — the system confirms each symbol via SAHMK `/companies/` on first run before anything goes live.

---

## How the system uses this list

1. **Resolve + verify:** on first run, look up each name via SAHMK `/companies/`, lock the real symbol, pull live quote + 6-12 months of daily history.
2. **Screen on live data:** drop names already extended (RSI > 70, far above trend) or broken down (below key moving average). Apply your market-cap band.
3. **Rank by momentum + conviction:** score each survivor 0-100 on trend strength, RSI position, and distance to a sensible entry level.
4. **Watch + alert:** set entry/stop/target levels per surviving name and alert via Discord when price hits one, regime filter permitting.

So this list is the starting universe. The system narrows it to what's actually actionable on live data, instead of trusting a static "top 10."

---

## What's left

- The SAHMK API key (Free is fine to start) so the system can verify symbols and pull live momentum. Until then, tickers marked "verify" are unconfirmed and should not be traded on.
- Heads-up: most of these are 2023-2025 IPOs. Newer listings can be more volatile and have thinner history for the technicals. The system handles that by requiring enough price history before it scores a name, and by leaning on the regime filter.

Sources for the added names: [Argaam — 2025 IPOs: 13 on TASI](https://www.argaam.com/en/article/articledetail/id/1869916), [Investing.com — Jamjoom Pharma (4015)](https://www.investing.com/equities/jamjoom-pharmaceuticals-factory), [Argaam — Avalon Pharma debut](https://www.argaam.com/en/article/articledetail/id/1708219), [Bloomberg — Almoosa Health IPO debut](https://www.bloomberg.com/news/articles/2025-01-07/saudi-arabia-s-almoosa-rallies-in-debut-after-450-million-ipo).
