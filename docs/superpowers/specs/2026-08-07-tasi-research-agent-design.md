# TASI Research Agent Design

## Goal

Add a private, bilingual, read-only research agent to the existing Action
Cockpit. It explains only scanner-qualified ideas and their deterministic
levels; it never places, records, sizes, or changes a trade.

## User experience

- A scanner card with `conditions_met >= 2` opens a split research workspace.
- Technical Setup and Entry Plan come directly from the deterministic snapshot.
- Company & News and Risks are researched on demand, are visibly cited, and
  stream into the workspace as available.
- Every stock has a persistent bilingual conversation. The user can add a
  manual broker price as temporary context; it is labelled user-supplied.
- A comparison view includes only the current qualified scanner names.
- Agent verdicts are `RESEARCH`, `WAIT`, and `SKIP`; none means buy.

## Trust boundary and data flow

The browser calls same-origin Sites routes. These read the private Sites
identity headers, enforce one configured owner email, and forward a short-lived
signed request to FastAPI on Cloud Run. FastAPI validates the signature, reads
the deterministic snapshot and read-only portfolio context, then owns research,
chat, comparison, cost control, and Firestore persistence.

OpenAI Responses web search is used only to create or refresh a report. The
request prioritizes Saudi Exchange, CMA, issuer investor-relations pages, then
an allowlist of reputable news domains. Source text is untrusted: it cannot
invoke application tools or alter deterministic outputs. Follow-up chat and
comparison use saved report evidence only and do not browse.

## Cost and resilience

- GPT-5.6 Terra creates cited reports; GPT-5.6 Luna handles grounded chat and
  comparisons. Both model identifiers are environment-configurable.
- A Firestore transaction reserves request cost. New AI work stops at 45 SAR,
  retaining 5 SAR beneath the 50 SAR monthly ceiling.
- A report is reused for the same authenticated user, symbol, and Riyadh
  trading date. Refresh requires explicit confirmation and creates no duplicate
  concurrent run.
- A research outage or invalid response never hides scanner cards or prevents
  deterministic alerts. Successful sections remain visible and failed sections
  expose a retry state.

## Out of scope

No paid live quote feed, broker integration, trade proposals, position writes,
ledger writes, automatic research, or non-qualified-symbol research is added in
this release.
