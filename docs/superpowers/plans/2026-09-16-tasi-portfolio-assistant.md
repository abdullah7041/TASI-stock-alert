# Portfolio assistant checkpoint

Implements delivery step 3 of the approved decision copilot rescue design, inline as requested.

- Reuse owner identity and the existing research budget reservation.
- Load current ledger, daily snapshot freshness, delayed quotes, alerts, and conversation history for every question.
- Keep evidence separate from system instructions; explicitly describe missing data and delayed prices.
- Persist user/assistant messages together only after a valid structured response.
- Return optional decision drafts with conditions and invalidation. Only the explicit confirmation endpoint persists a decision note.
- Store revisions as new notes, preserving history. Never append portfolio trades from this service.
- Support automatic, English, and Arabic reply language and RTL text.
- Preserve the question on provider errors and enforce request deadlines.

The assistant uses the existing AGENT_CHAT_MODEL and OPENAI_API_KEY configuration. The budget reservation remains charged after dispatch even on timeout because provider work may have occurred. Existing estimated reservation costs are not actual invoiced usage.

Integration repair: allow POST /api/pulse/ingest through the authenticated machine relay; keep the copilot owner-only.

Verification: route tests cover owner rejection, mandatory confirmation, ledger context, budget exhaustion, and absence of trade writes. UI tests cover editing and confirmation and preserving questions on failure. Full repository CI checks are required before checkpointing.

Live model and deployed D1 verification remain deployment checks; local provider responses are mocked. Discord conversation commands and event-outcome validation are the next delivery steps.
