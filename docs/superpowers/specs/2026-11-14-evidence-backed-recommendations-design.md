# Evidence-backed TASI recommendations

Date: 2026-11-14, Riyadh. Status: approved for implementation and evaluation; production promotion remains separate.
Source reviewed: remote main `7605f2b`; the open working tree is older and is not an implementation base.

## Intent and agreed direction

The owner cannot readily find specific buy/sell recommendations for held companies or other stocks worth watching. Supporting evidence is the requirement for trusting a recommendation. They selected evidence-backed recommendations, starting with saved holdings and a small potential-buy shortlist, over improving research summaries alone.

Success: for each covered company the owner can identify the proposed action, inspect its supporting and contrary evidence, understand what would change it, and distinguish a blocked assessment from a completed assessment. Success is not a promised return or a required trade.

The recommendations remain advisory. The owner makes decisions and executes trades manually. One saved portfolio remains authoritative; do not reintroduce broker accounts or infer current holdings from old configuration. Retain the existing long-term Saudi individual-stock scope and confirmed investor profile. If no profile is confirmed, show the setup requirement rather than silently adopting the default profile as consent.

## Approaches

1. Improve summaries only: smaller change but still requires the owner to derive the recommendation. Not selected.
2. Connect reviewed evidence to explicit recommendations: selected in conversation. More useful, but requires defined action semantics, evidence gates, and evaluation before release.

This design proposes qualitative AI interpretation behind deterministic eligibility and evidence checks. It does not introduce an unvalidated numerical strength score or portray a model opinion as a fact. This mechanism is the author's proposal, not an already agreed investment methodology.

## Scope and boundaries

Cover every current saved holding, plus at most three non-held companies in the initial research shortlist. Three is an author-proposed presentation and cost limit, not a diversification rule. Use the existing technical research candidates in their existing order, remove duplicates and ineligible instruments, and take the first three. Describe the list as a screened subset, never the best three stocks in TASI. If screening fails, report that failure; do not silently reuse an old list as current or fill it with invented candidates.

Reuse the current stack, official-source collection, evidence review, investor profile, company cases, model provider, budget, and saved decision history. No new data vendor or dependency is proposed.

Excluded: order execution, quantities, automatic cash allocation, numerical risk limits, price targets, success probabilities, whole-market ranking, new notification schedules, and broker integration. Existing Top 10 approval remains separate. This work does not automatically approve or replace that list.

## Recommendation contract

Separate assessment status from suggested action:

- Status: ready for owner review, blocked, failed, or superseded.
- Action, only when ready: BUY, ADD, HOLD, REDUCE, SELL, or WATCH.
- Always identify symbol, ownership, analysis time, evidence dates, source coverage, and evaluation status.
- Show a short rationale, supporting claims, strongest contrary evidence, relevant risks, missing information, and what would invalidate the interpretation.
- Each factual claim links to a specific reviewed evidence field or excerpt and its source URL, publication/report period, and revision. Label owner beliefs, model interpretation, and verified inputs separately. A citation URL alone is not proof the source supports the claim.
- No percentage confidence. Explain evidence completeness and limitations directly.

Action meanings proposed for design approval:

| Action | Required interpretation |
| --- | --- |
| BUY | Non-held company has a supported long-term case, reviewed valuation context and qualified entry conditions in the dated snapshot. Current broker verification remains necessary; affordability is not asserted. |
| ADD | Same checks as BUY, for a held company. Explicitly state that amount and portfolio allocation have not been assessed. |
| HOLD | A reviewed existing ownership case remains supported after considering contrary evidence; lack of fresh bad news alone is insufficient. |
| REDUCE | Reviewed evidence materially weakens part of the ownership case while a remaining rationale is supported; state why partial rather than full exit merits consideration, without a quantity. |
| SELL | Reviewed evidence contradicts the core ownership case or a confirmed reconsideration condition; explain why retaining the position is no longer supported and show counter-evidence. |
| WATCH | Adequate reviewed evidence supports continued observation, but buying is not justified under the defined conditions; state what would need to change. |

An inability to distinguish actions reliably produces a blocked assessment with the unresolved question, not a fabricated decisive answer. Missing inputs never become HOLD or WATCH by default. Price weakness, an old stop/target, or concentration alone cannot justify REDUCE or SELL. Unavailable current pricing blocks BUY/ADD qualification but need not hide a documented company-case deterioration; show the latter with its market-data limitation and broker-verification requirement.

## Evidence and generation flow

1. Read the authoritative saved portfolio and confirmed profile. For holdings, require a current confirmed ownership case. For shortlist companies, create a separate research case; do not pretend the owner already owns or has confirmed it.
2. Load existing sector-specific reviewed metrics, valuation and downside context, official disclosures and dated market observations. Announcement titles are leads only. Do not infer financial facts from titles.
3. Expose missing facts and next steps. Prefill company/source metadata already known by the application. Financial extraction, if included later, remains a draft requiring review; a general document-extraction pipeline is not required for this first slice.
4. Run deterministic ownership, freshness, coverage and input-validity checks. Reuse existing expected-session market checks. A filing's retrieval date cannot renew its publication date. Latest-report coverage must be explicitly established; unknown or unresolved newer material disclosures block a ready recommendation.
5. Request a structured interpretation using only that evidence bundle. A model proposes an action and claim-to-evidence references. Validate the allowed action for ownership, required fields, references, revisions and all prerequisite checks on the server. Do not execute model text or obey instructions in sources.
6. Save the dated recommendation with evidence/profile/case/portfolio revisions, model identifier and prompt/policy version. Recheck revisions before saving; changes during generation prevent a ready result. Reuse unchanged results instead of charging for repeated requests.
7. Show current recommendations and specific blockers through Overview and company details; preserve older results as dated history. Acknowledging a recommendation is not acceptance of its evidence, a trade, or a portfolio mutation.

Ready results must be invalidated when their prerequisite evidence, confirmed profile/case, relevant ownership, or market freshness changes. On failed refresh retain the last result visibly as historical, never as today's recommendation. A successful empty source response, a failed source and actual content remain different states.

## Integration and consistency

Reuse `holding-secretary-service.ts` and its evidence/version infrastructure where suitable, but do not simply widen its WATCH/RESEARCH_MORE enum and change labels. Extend the shared contract and its consumers together. Existing review records keep their historical meaning.

Connect the company-specific summary to `ActionCockpit.tsx`, replacing the fixed pending message. Bring the current ownership case and latest relevant interpretation together in company review. `EvidenceReviewForm.tsx` should preserve source dates and reduce repeated metadata entry. Keep human-reviewed grades distinct from verified numeric facts.

Python artifacts, cockpit, assistant and any existing Discord summary must agree on action meanings and readiness. Old technical BUY/SELL labels remain explicitly technical observations, not an alternative investment recommendation. Before release, trace all producer and notification consumers to prevent conflicting suggestions. No actionable Discord messages from the new policy during evaluation; existing scheduled-review and delivery gates remain unchanged.

## Evaluation and release

First implement a clearly labelled evaluation mode in the cockpit. It must actually exercise proposed actions, not merely display permanent pending labels. It is not yet a qualified recommendation service.

Before implementation, the implementation plan must fix a versioned policy rubric, sector-specific coverage/freshness definitions, entry criteria, and evaluation cases. These are explicit policy proposals for owner review, not thresholds the builder may invent silently. Existing grades or historical scanner tests do not establish the validity of the new recommendation policy.

Evaluate chronological evidence bundles with future information excluded. Cases must cover every action plus failed/empty/partial/stale sources, conflicting evidence, unsupported citations, title-only notices, changed ownership, policy revisions and budget/provider failure. Predeclare the cases and checks before inspecting generated outputs. Require no unsupported factual claims, invalid action/ownership combinations, or bypassed blockers in the release set; any such failure blocks promotion. These checks establish grounding and behavior only, not investment performance. Owner review of representative recommendation explanations is also required before removing the evaluation label. Do not activate automatic recommendations or notifications by default.

Run implementation checks from AGENTS.md: Python compile and specified pytest suites; web lint, typecheck, full npm test, and git diff --check. Use explicit clocks and unique history-cache keys. Add focused checks for revision races, evidence freshness and producer/UI agreement. Run authenticated deployed read-only checks separately before claiming live readiness. No tests, deployment or profitability validation are claimed by this design document.

## Author choices and remaining decisions

Author proposals: three shortlist companies; qualitative interpretation with deterministic gates; no quantities or confidence scores; evaluation-first rollout. Approval of this design accepts these product boundaries, not an unseen policy rubric or production promotion.

The builder may choose compatible type names, minimal additive persistence, component boundaries and exact wording, while preserving owner isolation, history, budget reservations and retry safety. Build from current remote main in an isolated checkout, preserving unrelated local work and machine-written JSON.

This is a multi-part project, not a label fix. Sequence: define and review the policy rubric; establish evidence completeness and recommendation contracts; connect the review experience; evaluate; then explicitly qualify release. The next step after design approval is a written implementation plan, not immediate deployment.
