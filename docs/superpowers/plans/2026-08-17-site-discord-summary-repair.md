# Site and Discord Summary Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make the cockpit and Discord render one dated, delayed-analysis summary; surface independently ingested unusual movements; and make recurring official-source research collection visible without manufacturing evidence.

**Architecture:** Python creates a backward-compatible summaryV1 object inside the existing schema-v2 snapshot, and Discord renders that object rather than legacy recommendation records. The Worker validates and returns that summary plus separately stored alerts, while the React cockpit renders the returned payload. A conservative official-source collector writes a review queue; only fully validated evidence records can feed the approval-gated Top 10.

**Tech Stack:** Python 3.12/pytest, Node 22/node:test, TypeScript, React 19, vinext, Cloudflare D1, GitHub Actions, Saudi Exchange public issuer-announcements portal.

## Global Constraints

- Keep schemaVersion: 2; summaryV1 is optional when reading old snapshots and always emitted by new producers.
- Retain D1 keys latest and latest-v2; do not delete or rewrite either key during this release.
- Label every site and Discord decision as delayed analysis; the broker app owns real-time price protection and neither surface places an order.
- Send one routine pre-open Discord digest and one movement Discord message only when one or more new unusual-movement alert IDs are produced.
- Do not turn missing evidence into a price-only Top 10. The agreed maximum is two companies per sector, and approval remains explicit.
- The source collector may use only https://www.saudiexchange.sa issuer-announcement pages and issuer links reached from them. It must not call undocumented Exchange endpoints.
- Production smoke tests must not post Discord, send broker orders, or delete D1 data.
- GitHub Actions timing is best effort. Persist and display scheduled-versus-actual timing rather than presenting a late digest as on time.

## File map

- Create: summary_contract.py — deterministic snapshot summary cards and scheduled-lateness metadata.
- Modify: main.py — attach summaryV1, render the daily Discord digest from the snapshot, send movement-only session messages, and collect official-source evidence candidates.
- Modify: notify.py — pure formatters for daily summary cards and delayed movement cards.
- Modify: test_core.py — producer, Discord, workflow, and delayed-movement regression tests.
- Modify: app/lib/dashboard-types.ts — TypeScript contract for SummaryV1, cards, and payload-level alerts.
- Modify: app/lib/dashboard-core.mjs and app/lib/dashboard-core.d.mts — validate and preserve optional summaryV1 on a v2 snapshot.
- Modify: app/api/dashboard/route.ts — compose the saved snapshot with the independent alert store.
- Modify: app/components/ActionCockpit.tsx — render summary cards and payload-level alerts with delayed timestamps.
- Modify: tests/dashboard-core.test.mjs and tests/action-cockpit.test.mjs — contract and rendering-boundary tests.
- Create: research/official_sources.py — official portal URL validation, retrieval, parsing, deduplication, and queue serialization.
- Create: research/test_official_sources.py and research/fixtures/official_announcements.html — offline parser and failure behavior tests.
- Modify: .github/workflows/tasi.yml — research-evidence scheduling, explicit job telemetry, strict state persistence, and safe mode routing.
- Modify: .github/workflows/sites-production-smoke.yml — verify the dashboard response includes a separate alerts collection without posting Discord.

---

### Task 1: Define the Python canonical summary contract

**Files:**
- Create: summary_contract.py
- Modify: main.py:203-257
- Test: test_core.py

**Interfaces:**
- Consumes: a schema-v2 snapshot dictionary containing asOf, tradeDate, urgent, top10, forecast, warnings, and monthlyBudgetSar.
- Produces: build_summary_v1(snapshot: dict, scheduled_for: str | None) -> dict with version, generatedAt, scheduledFor, latenessMinutes, and ordered {kind, state, text} cards.
- Produces: summary_lines(summary: dict) -> list[str] for the existing summary string list.

- [ ] **Step 1: Write failing summary-contract tests**

Add tests that use a fixed snapshot and assert the ordered cards are deterministic, Top 10 reports evidence-pending when entries are empty, the forecast reports unavailable, and a digest scheduled for 06:45:00Z with asOf at 07:38:24Z reports 53 lateness minutes.

~~~python
def test_summary_v1_is_dated_and_keeps_missing_evidence_honest():
    snapshot = {
        "asOf": "2026-08-17T07:38:24Z", "tradeDate": "2026-08-17",
        "urgent": [], "warnings": ["Top 10 draft unavailable: no current primary-source evidence has been reviewed yet."],
        "monthlyBudgetSar": 500,
        "top10": {"status": "draft", "entries": [], "researchedAt": "2026-08-17T07:38:24Z"},
        "forecast": {"status": "unavailable", "asOf": "2026-08-17", "reason": "Validation gates not passed."},
    }
    summary = summary_contract.build_summary_v1(snapshot, scheduled_for="2026-08-17T06:45:00Z")
    assert summary["latenessMinutes"] == 53
    assert summary["cards"][1] == {"kind": "top10", "state": "evidence-pending", "text": "Top 10: evidence pending; no current primary-source review."}
~~~

- [ ] **Step 2: Run the new test to prove the contract is absent**

Run: python -m pytest test_core.py -k summary_v1 -v

Expected: import failure for summary_contract.

- [ ] **Step 3: Implement the minimal summary builder**

Create summary_contract.py. Build exactly four ordered cards: portfolio action state, Top 10 evidence state, delayed-analysis safety boundary, and forecast state. Derive latenessMinutes only when both timestamps parse as UTC and clamp negative values to zero.

~~~python
def build_summary_v1(snapshot: dict, scheduled_for: str | None) -> dict:
    generated_at = str(snapshot["asOf"])
    urgent = list(snapshot.get("urgent") or [])
    top10 = dict(snapshot.get("top10") or {})
    forecast = dict(snapshot.get("forecast") or {})
    cards = [
        {"kind": "portfolio", "state": "action" if urgent else "clear", "text": f"{len(urgent)} confirmed holding action(s) require review." if urgent else "No confirmed trade requires action."},
        {"kind": "top10", "state": "ready" if top10.get("entries") else "evidence-pending", "text": f"Top 10: {len(top10.get('entries') or [])} evidence-ranked companies ready for review." if top10.get("entries") else "Top 10: evidence pending; no current primary-source review."},
        {"kind": "safety", "state": "delayed", "text": "Broker app owns real-time price alerts; this digest is delayed analysis."},
        {"kind": "forecast", "state": str(forecast.get("status", "unavailable")), "text": "Forecast unavailable: validation gates not passed." if forecast.get("status") == "unavailable" else "Forecast available only as a validated delayed-analysis reference."},
    ]
    return {"version": 1, "generatedAt": generated_at, "scheduledFor": scheduled_for, "latenessMinutes": _lateness_minutes(generated_at, scheduled_for), "cards": cards}
~~~

In _dashboard_snapshot, build the ordinary snapshot first, set summaryV1 to this result, and set its existing summary field to summary_lines(summaryV1). Add a keyword-only scheduled_for: str | None = None argument so manual safe refreshes remain valid.

- [ ] **Step 4: Run the focused Python tests and existing snapshot tests**

Run: python -m pytest test_core.py -k "summary_v1 or dashboard_snapshot" -v

Expected: PASS, including current Top 10 unavailable behavior.

- [ ] **Step 5: Commit the isolated contract change**

~~~bash
git add summary_contract.py main.py test_core.py
git commit -m "feat: add canonical dashboard summary contract"
~~~

### Task 2: Preserve summaryV1 in the site contract and show D1 alerts

**Files:**
- Modify: app/lib/dashboard-types.ts
- Modify: app/lib/dashboard-core.mjs
- Modify: app/lib/dashboard-core.d.mts
- Modify: app/api/dashboard/route.ts
- Modify: app/components/ActionCockpit.tsx
- Test: tests/dashboard-core.test.mjs
- Test: tests/action-cockpit.test.mjs

**Interfaces:**
- Consumes: a schema-v2 snapshot with optional summaryV1 and AlertStore.latest(limit).
- Produces: DashboardPayload = { snapshot, freshness, alerts }, where alerts is always an array and is independent of the saved daily snapshot time.
- Produces: SummaryV1 = { version: 1; generatedAt: string; scheduledFor: string | null; latenessMinutes: number | null; cards: SummaryCard[] }.

- [ ] **Step 1: Write failing parser and response-boundary tests**

Extend tests/dashboard-core.test.mjs to parse a v2 snapshot containing summaryV1, assert its card fields survive parsing, and parse an old v2 snapshot without it. Extend tests/action-cockpit.test.mjs to require the dashboard route to use AlertStore and the component to read payload.alerts instead of only snapshot.alerts.

~~~javascript
test("preserves an optional canonical summary in a version-2 snapshot", () => {
  const parsed = parseDashboardSnapshot({
    ...validSnapshot, schemaVersion: 2, summary: ["legacy line"],
    summaryV1: { version: 1, generatedAt: "2026-08-17T07:38:24Z", scheduledFor: "2026-08-17T06:45:00Z", latenessMinutes: 53,
      cards: [{ kind: "top10", state: "evidence-pending", text: "Top 10: evidence pending; no current primary-source review." }] },
    top10: { proposalId: "top10-2026-08-17", status: "draft", researchedAt: "2026-08-17T07:38:24Z", entries: [] },
    portfolio: { confirmedAt: "2026-08-17T07:38:24Z", cashSar: 0, contributionMonth: null, holdings: [], proposal: null },
    alerts: [], forecast: { status: "unavailable", asOf: "2026-08-17", reason: "Validation gates not passed." },
  });
  assert.equal(parsed.summaryV1.cards[0].kind, "top10");
});
~~~

- [ ] **Step 2: Run the focused Node tests to prove the boundary is missing**

Run: node --test tests/dashboard-core.test.mjs tests/action-cockpit.test.mjs

Expected: FAIL because summaryV1 and payload-level alerts are not represented.

- [ ] **Step 3: Implement backward-compatible parsing and response composition**

Add SummaryCard and SummaryV1 types. Keep summaryV1 optional in DashboardSnapshotV2 so stored snapshots from before this release remain readable. In parseDashboardSnapshot, validate version equals 1, finite non-negative latenessMinutes when non-null, and non-empty text, kind, and state on every card.

Change the route to read both stores without altering the snapshot:

~~~typescript
const [snapshot, alerts] = await Promise.all([
  new DashboardStore(env.DB).latest(),
  new AlertStore(env.DB).latest(20),
]);
if (!snapshot) return Response.json({ error: "No daily digest has been saved yet." }, { status: 404 });
return Response.json({ snapshot, freshness: dashboardFreshness(snapshot), alerts }, { headers: { "Cache-Control": "no-store" } });
~~~

In ActionCockpit, display v2.summaryV1?.cards when present and map the legacy string list only when it is absent. Render payload.alerts in the unusual-movement section; preserve each alert's observed timestamp and the existing delayed bot label.

- [ ] **Step 4: Run contract, type, and UI checks**

Run: npm run typecheck

Run: node --test tests/dashboard-core.test.mjs tests/action-cockpit.test.mjs

Expected: PASS. An old v2 snapshot still parses, and separately stored alerts are visible through the response contract.

- [ ] **Step 5: Commit the Worker and cockpit boundary**

~~~bash
git add app/lib/dashboard-types.ts app/lib/dashboard-core.mjs app/lib/dashboard-core.d.mts app/api/dashboard/route.ts app/components/ActionCockpit.tsx tests/dashboard-core.test.mjs tests/action-cockpit.test.mjs
git commit -m "feat: compose dashboard alerts with canonical summaries"
~~~

### Task 3: Render Discord from the daily snapshot and movement alerts only

**Files:**
- Modify: notify.py:247-342
- Modify: main.py:444-540
- Test: test_core.py

**Interfaces:**
- Consumes: a saved v2 dashboard snapshot with summaryV1 and a list of delayed movement-alert dictionaries.
- Produces: build_dashboard_digest(snapshot: dict) -> str and build_movement_alert_message(alerts: list[dict], as_of: str) -> str.
- Produces: one Discord delivery for mode_digest; zero or one delivery for mode_run, solely when movement_alerts is non-empty.

- [ ] **Step 1: Write failing Discord regression tests**

Mock main.nt.send_discord and assert mode_digest sends the canonical Top 10 and forecast cards rather than legacy build_message output. Add a session-mode test with one movement alert and one ordinary actionable recommendation; assert the message contains the movement alert, delayed timestamp, and broker boundary but not the legacy price-level recommendation card.

~~~python
def test_session_mode_sends_only_new_delayed_movement_cards(monkeypatch, tmp_path):
    monkeypatch.setattr(main, "HERE", tmp_path)
    monkeypatch.setattr(main, "_collect_recs", lambda **_: ("range", [{"code": "1303", "action": "BUY"}], {"monthly_cap": 500}))
    monkeypatch.setattr(main, "_movement_alerts", lambda *_: [{"alertId": "m-1303-20260817", "code": "1303", "direction": "upside", "observedAt": "2026-08-17T10:15:00Z", "receivedAt": "2026-08-17T10:18:00Z", "latency": "delayed-intraday", "excessMovePct": 2.4, "robustZ": 3.2, "reason": "Move exceeded delayed baseline."}])
    sent = []
    monkeypatch.setattr(main.nt, "send_discord", lambda content: sent.append(content) or True)
    assert main.mode_run() == 0
    assert "1303" in sent[0] and "Delayed analysis" in sent[0]
    assert "TASI alert" not in sent[0]
~~~

- [ ] **Step 2: Run the focused tests to prove legacy behavior fails the assertions**

Run: python -m pytest test_core.py -k "discord or session_mode" -v

Expected: FAIL because mode_digest calls build_message and mode_run sends legacy actionable recommendations.

- [ ] **Step 3: Implement pure snapshot and alert formatters, then migrate both modes**

Add two pure functions to notify.py. build_dashboard_digest reads snapshot["summaryV1"]["cards"], titles the output with snapshot["tradeDate"], and includes the exact card text in order. build_movement_alert_message sorts by observedAt, includes code, direction, reason, observed/received times, and the fixed broker boundary.

~~~python
def build_dashboard_digest(snapshot: dict) -> str:
    summary = dict(snapshot["summaryV1"])
    lines = [f"__**TASI delayed digest ({snapshot['tradeDate']})**__"]
    lines.extend(f"- {card['text']}" for card in summary["cards"])
    if summary["latenessMinutes"]:
        lines.append(f"- Digest started {summary['latenessMinutes']} minutes after its scheduled time.")
    return "\n".join(lines)
~~~

In mode_digest, construct the snapshot once, save it, then call nt.send_discord(nt.build_dashboard_digest(snapshot)). In mode_run, save movement alerts, return without Discord when the list is empty, and otherwise send nt.build_movement_alert_message(movement_alerts, received_at). Do not call nt.build_message from either mode.

- [ ] **Step 4: Run all affected Python tests**

Run: python -m pytest test_core.py -k "dashboard_snapshot or discord or movement or mode_run or mode_digest" -v

Expected: PASS. The test doubles confirm content generation without making an HTTP webhook request.

- [ ] **Step 5: Commit the synchronized notification behavior**

~~~bash
git add notify.py main.py test_core.py
git commit -m "feat: render Discord from cockpit summary data"
~~~

### Task 4: Make the production scheduler observable and state commits strict

**Files:**
- Modify: .github/workflows/tasi.yml
- Modify: main.py:444-475
- Test: test_core.py

**Interfaces:**
- Consumes: MODE, SCHEDULED_FOR, SAHMK_API_KEY, DISCORD_WEBHOOK_URL, cockpit tokens, and generated JSON files.
- Produces: a GitHub job summary containing mode, scheduled time, actual UTC time, latest dashboard asOf, alert ingest count, Discord outcome, and GITHUB_SHA.
- Produces: persisted state only when git add and git push actually succeed.

- [ ] **Step 1: Write workflow-contract tests**

Extend test_core.py to require the research-evidence dispatch mode, the Wednesday 15 5 * * 3 collection cron, SCHEDULED_FOR, a git add loop guarded by -e, and no 2>/dev/null || true around state staging or push.

~~~python
def test_scheduler_records_lateness_and_does_not_hide_state_commit_failures():
    workflow = Path(".github/workflows/tasi.yml").read_text(encoding="utf-8")
    assert "SCHEDULED_FOR" in workflow
    assert 'cron: "15 5 * * 3"' in workflow
    assert "for path in" in workflow and '[ -e "$path" ]' in workflow
    assert "git add state.json" not in workflow
    assert "git push 2>/dev/null" not in workflow
~~~

- [ ] **Step 2: Run the workflow-contract test to prove it fails**

Run: python -m pytest test_core.py -k scheduler_records_lateness -v

Expected: FAIL because the current workflow hides state staging and push failures.

- [ ] **Step 3: Implement explicit mode metadata and safe state persistence**

Add research-evidence to the manual dispatch description and route the Wednesday cron to it. For the digest cron, set SCHEDULED_FOR="$(date -u +%F)T06:45:00Z"; for other modes set SCHEDULED_FOR=manual or their explicit session slot. Pass it to python main.py, and have mode_digest pass the parsed value to _dashboard_snapshot.

After producer and ingest steps, append a summary using generated files rather than secrets:

~~~bash
python - <<'PY' >> "$GITHUB_STEP_SUMMARY"
import json, os
mode = os.environ["MODE"]
print(f"mode={mode}")
print(f"commit={os.environ['GITHUB_SHA']}")
print(f"actual_utc={os.environ['ACTUAL_UTC']}")
if mode in {"digest", "top10-draft", "cockpit-refresh"}:
    snapshot = json.load(open("dashboard.json", encoding="utf-8"))
    print(f"dashboard_as_of={snapshot['asOf']}")
    print(f"scheduled_for={snapshot.get('summaryV1', {}).get('scheduledFor')}")
PY
~~~

Replace broad staging with this exact loop and let failures stop the job:

~~~bash
for path in state.json levels.json symbols.json news_archive.jsonl history.json dashboard.json top10_draft.json movement_state.json movement_alerts.json research/evidence_queue.json; do
  if [ -e "$path" ]; then git add -- "$path"; fi
done
if ! git diff --cached --quiet; then git commit -m "state update [skip ci]"; fi
git push
~~~

- [ ] **Step 4: Run workflow checks and focused tests**

Run: python -m pytest test_core.py -k "workflow or scheduler or mode_digest" -v

Run: python - <<'PY'
from pathlib import Path
import yaml
yaml.safe_load(Path(".github/workflows/tasi.yml").read_text(encoding="utf-8"))
print("workflow YAML valid")
PY

Expected: PASS and valid YAML.

- [ ] **Step 5: Commit the reliable scheduler contract**

~~~bash
git add .github/workflows/tasi.yml main.py test_core.py
git commit -m "fix: expose scheduler latency and state failures"
~~~

### Task 5: Collect official filings into a review queue without inventing evidence

**Files:**
- Create: research/official_sources.py
- Create: research/test_official_sources.py
- Create: research/fixtures/official_announcements.html
- Modify: main.py:40-55,459-475,645-651
- Modify: research/__init__.py
- Test: research/test_company_evidence.py

**Interfaces:**
- Consumes: the official Saudi Exchange [issuer-announcements portal](https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements?locale=en), a UTC retrieval time, and a bounded lookback window.
- Produces: collect_official_announcements(session, retrieved_at, lookback_days) -> list[OfficialAnnouncement] where every URL is HTTPS on www.saudiexchange.sa.
- Produces: research/evidence_queue.json with status, retrievedAt, and de-duplicated announcement candidates. It does not write research/evidence.json and does not alter Top 10 until a full existing EvidenceRecord passes validation.

- [ ] **Step 1: Write offline parser and provenance tests**

Create an HTML fixture containing an official relative announcement-detail link, one absolute official PDF link, and one external link. Test that only the first two are returned, duplicate URLs collapse to one item, and a fetch exception leaves the previous queue unmodified by mode_research_evidence.

~~~python
def test_parser_keeps_only_official_announcement_links():
    html = Path("research/fixtures/official_announcements.html").read_text(encoding="utf-8")
    records = official_sources.parse_official_announcements(html, "2026-08-17T05:15:00Z")
    assert [record.url for record in records] == [
        "https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news/issuer-announcements/issuer-announcements-details/example",
        "https://www.saudiexchange.sa/Resources/fsPdf/example.pdf",
    ]
~~~

- [ ] **Step 2: Run the offline tests to prove the collector is missing**

Run: python -m pytest research/test_official_sources.py -v

Expected: FAIL because research.official_sources does not exist.

- [ ] **Step 3: Implement the bounded official-source collector and queue mode**

Use the public portal URL above with a normal requests.Session, a 20-second timeout, one retry after a transient HTTP failure, and a descriptive User-Agent. Parse only anchors whose resolved URL is HTTPS and whose hostname is exactly www.saudiexchange.sa; retain visible anchor text, URL, and retrieval time. Do not call an undocumented JSON endpoint and do not grade financial metrics from announcement text.

~~~python
OFFICIAL_HOST = "www.saudiexchange.sa"

def is_official_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname == OFFICIAL_HOST

def parse_official_announcements(html: str, retrieved_at: str) -> list[OfficialAnnouncement]:
    soup = BeautifulSoup(html, "html.parser")
    found: dict[str, OfficialAnnouncement] = {}
    for anchor in soup.select("a[href]"):
        url = urljoin(PORTAL_URL, anchor["href"])
        title = anchor.get_text(" ", strip=True)
        if title and is_official_url(url) and ("issuer-announcements-details" in url or "/Resources/fsPdf/" in url):
            found.setdefault(url, OfficialAnnouncement(title=title, url=url, retrieved_at=retrieved_at))
    return list(found.values())
~~~

Add mode_research_evidence to write a queue atomically only after successful collection. On an unavailable portal, print the factual error and return non-zero without replacing the last valid queue. Preserve the existing EvidenceRecord validator and _evidence_top10 unchanged: a human-reviewed record must still contain every required metric and source URL before it appears in research/evidence.json.

- [ ] **Step 4: Run source, provenance, and Top 10 validation tests**

Run: python -m pytest research/test_official_sources.py research/test_company_evidence.py research/test_top10.py -v

Expected: PASS. External or malformed links never enter the queue, and incomplete records still cannot create a Top 10 entry.

- [ ] **Step 5: Commit the primary-source collection foundation**

~~~bash
git add research/official_sources.py research/test_official_sources.py research/fixtures/official_announcements.html research/__init__.py main.py test_core.py
git commit -m "feat: collect official filing evidence candidates"
~~~

### Task 6: Verify release safety and publish only after approval

**Files:**
- Modify: .github/workflows/sites-production-smoke.yml
- Modify: docs/sites-release-runbook.md
- Test: test_core.py
- Test: tests/action-cockpit.test.mjs

**Interfaces:**
- Consumes: an approved private Sites version, EXPECTED_COMMIT_SHA, the no-notification cockpit-refresh mode, and production health/dashboard responses.
- Produces: a smoke result proving deployment provenance, accepted snapshot schemas, a current Riyadh date, and a dashboard alerts array without a Discord or broker side effect.

- [ ] **Step 1: Write failing smoke-contract tests**

Add assertions that the smoke workflow requests /api/dashboard, validates alerts as an array, preserves MODE=cockpit-refresh, and never references DISCORD_WEBHOOK_URL. Add a cockpit static test that requires payload-level alerts to be rendered.

~~~python
def test_production_smoke_checks_composed_alerts_without_discord():
    smoke = Path(".github/workflows/sites-production-smoke.yml").read_text(encoding="utf-8")
    assert "/api/dashboard" in smoke
    assert "alerts" in smoke
    assert "MODE: cockpit-refresh" in smoke
    assert "DISCORD_WEBHOOK_URL" not in smoke
~~~

- [ ] **Step 2: Run the smoke-contract test to prove it fails before the workflow change**

Run: python -m pytest test_core.py -k production_smoke_checks_composed_alerts -v

Expected: FAIL because current smoke does not assert the composed alerts response.

- [ ] **Step 3: Extend private smoke verification and release documentation**

After the existing health and dashboard fetches, parse the dashboard JSON and fail unless it contains a snapshot, a freshness value, and an alerts list. Do not invoke the webhook or mode_digest. Document the release sequence: CI at release SHA, manual readiness archive, private Sites deployment, production smoke, then wait for the next normal digest to prove Discord delivery in its GitHub summary.

~~~bash
python - <<'PY'
import json
payload = json.load(open("dashboard-response.json", encoding="utf-8"))
assert isinstance(payload.get("alerts"), list), "dashboard alerts collection missing"
assert payload.get("snapshot", {}).get("tradeDate"), "dashboard trade date missing"
assert payload.get("freshness") in {"current", "stale"}, "dashboard freshness missing"
print("dashboard alert composition verified")
PY
~~~

- [ ] **Step 4: Run the complete verification suite**

Run: python -m pytest -q

Run: npm run lint

Run: npm run typecheck

Run: npm run build && node --test tests/*.test.mjs

Run: git diff --check

Expected: all checks pass. If the Windows Rolldown optional-native-binding problem reappears before the build starts, reinstall active-worktree dependencies with npm ci --include=optional, rerun the build once, and require the Linux CI build before release.

- [ ] **Step 5: Commit release verification changes and perform the approval-gated release**

~~~bash
git add .github/workflows/sites-production-smoke.yml docs/sites-release-runbook.md test_core.py tests/action-cockpit.test.mjs
git commit -m "test: verify composed dashboard alerts in production smoke"
~~~

After CI succeeds on the merged SHA, use the existing release-readiness workflow, save one private Sites version built from that SHA, deploy privately, and run sites-production-smoke.yml. Do not publish or message Discord without the user’s separate production approval.

## Plan self-review

- **Spec coverage:** Task 1 creates the canonical dated summary; Task 2 makes it and independent alerts visible in Sites; Task 3 removes legacy Discord drift and limits session messages to unusual movements; Task 4 exposes lateness and fixes hidden state failures; Task 5 collects only official primary-source candidates while preserving the evidence gate; Task 6 tests rollback-safe release behavior and no-notification smoke checks.
- **Safety coverage:** Every task retains delayed wording, broker ownership, explicit approvals, v1/v2 snapshot preservation, no price-only Top 10, and no production Discord test post.
- **Type consistency:** Python summaryV1 has version, generatedAt, scheduledFor, latenessMinutes, and cards; TypeScript preserves the same names. API payload alerts are separate from snapshot.alerts and the UI reads the payload field.
- **Placeholder scan:** No unresolved implementation markers remain. The official source collector is deliberately limited to a provenance queue; metric grading remains the existing validated review boundary rather than an ungrounded automated inference.

