# Source from a bash workflow step. Never print this array or enable shell tracing.
COCKPIT_ORIGIN="${COCKPIT_ORIGIN:-https://tasi-action-cockpit.busaud7041.chatgpt.site}"
COCKPIT_AUTH_HEADERS=(-H "Authorization: Bearer ${COCKPIT_INGEST_TOKEN:-}")
case "$COCKPIT_ORIGIN" in
  https://tasi-action-cockpit.busaud7041.chatgpt.site)
    COCKPIT_AUTH_HEADERS+=(-H "OAI-Sites-Authorization: Bearer ${COCKPIT_SIWC_BYPASS_TOKEN:-}")
    cockpit_auth_ready() { test -n "${COCKPIT_INGEST_TOKEN:-}" && test -n "${COCKPIT_SIWC_BYPASS_TOKEN:-}"; }
    ;;
  https://tasi-action-cockpit.ronaldinho1415.workers.dev)
    COCKPIT_AUTH_HEADERS+=(-H "CF-Access-Client-Id: ${COCKPIT_ACCESS_CLIENT_ID:-}" -H "CF-Access-Client-Secret: ${COCKPIT_ACCESS_CLIENT_SECRET:-}")
    cockpit_auth_ready() { test -n "${COCKPIT_INGEST_TOKEN:-}" && test -n "${COCKPIT_ACCESS_CLIENT_ID:-}" && test -n "${COCKPIT_ACCESS_CLIENT_SECRET:-}"; }
    ;;
  *) echo 'Unrecognized cockpit origin; credentials were not sent.' >&2; exit 1 ;;
esac
