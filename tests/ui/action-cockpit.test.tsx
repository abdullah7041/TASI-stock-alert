import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ActionCockpit } from "@/app/components/ActionCockpit";
import { PriceVolumeChart } from "@/app/components/PriceVolumeChart";
import type { DashboardPayload, DashboardSnapshotV2, DashboardSnapshotV3 } from "@/app/lib/dashboard-types";
import type { MovementAlert } from "@/app/lib/evidence-types";

function alert(index: number, overrides: Partial<MovementAlert> = {}): MovementAlert {
  const minute = String(10 + index).padStart(2, "0");
  return {
    alertId: `nahdi-${index}`,
    code: "4164",
    name: "Nahdi Medical",
    direction: "upside",
    observedAt: `2026-08-19T10:${minute}:00Z`,
    receivedAt: `2026-08-19T10:${minute}:30Z`,
    latency: "delayed-intraday",
    excessMovePct: 2.4,
    robustZ: 4.6,
    volumeRatio: 2.5,
    reason: "Delayed bot confirmation of statistically unusual price movement.",
    ...overrides,
  };
}

const snapshot: DashboardSnapshotV2 = {
  schemaVersion: 2,
  tradeDate: "2026-08-19",
  asOf: "2026-08-19T06:40:00Z",
  regime: "range",
  dataStatus: "delayed-daily",
  warnings: [],
  urgent: [],
  changed: [],
  qualified: [],
  researchCount: 0,
  monthlyBudgetSar: 500,
  summary: ["No holding crossed a decision level."],
  top10: { proposalId: "p1", status: "draft", researchedAt: "2026-08-19T06:00:00Z", entries: [] },
  portfolio: { confirmedAt: "2026-08-19T06:00:00Z", cashSar: 120.5, contributionMonth: null, holdings: [], proposal: null },
  alerts: [],
  forecast: { status: "unavailable", asOf: "2026-08-19", reason: "validation gates not passed." },
};

const canonicalSnapshot: DashboardSnapshotV3 = {
  ...snapshot,
  schemaVersion: 3,
  artifactKind: "digest",
  artifactId: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  scheduledFor: "2026-08-19T06:45:00Z",
  producer: { generatedAt: "2026-08-19T06:40:00Z" },
  digestRecords: [{ code: "4164", name: "Nahdi Medical", lean: { unavailable: "no GEMINI_API_KEY configured" } }],
  leanStatus: { ok: false, provider: "gemini", reason: "no GEMINI_API_KEY configured" },
  charts: [{
    code: "4164", name: "Nahdi Medical", status: "available",
    bars: [
      { date: "2026-08-13", Open: 120, High: 122, Low: 119, Close: 121, Volume: 1100 },
      { date: "2026-08-14", Open: 121, High: 123, Low: 120, Close: 122, Volume: 1200 },
      { date: "2026-08-16", Open: 122, High: 124, Low: 121, Close: 123, Volume: 1300 },
      { date: "2026-08-17", Open: 123, High: 125, Low: 122, Close: 124, Volume: 1400 },
      { date: "2026-08-18", Open: 124, High: 126, Low: 123, Close: 125, Volume: 1500 },
    ], levels: { stop: 118, trim: 126, target: 130 },
  }],
};

function payload(overrides: Partial<DashboardPayload> = {}): DashboardPayload {
  return { snapshot, freshness: "current", alerts: [], ...overrides };
}

/**
 * The component refetches /api/dashboard on mount and replaces its state with
 * the response, so the stub has to serve the same payload the test rendered.
 */
function renderCockpit(dashboard: DashboardPayload) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(dashboard), { headers: { "content-type": "application/json" } })));
  return render(<ActionCockpit dashboard={dashboard} />);
}

afterEach(() => {
  // globals are off in vitest.config.ts, so auto-cleanup is not installed;
  // without this every render leaks into the next test's queries.
  cleanup();
  vi.unstubAllGlobals();
});

test("ten repeated observations of one company collapse into a single card", async () => {
  const alerts = Array.from({ length: 10 }, (_, index) => alert(index));
  renderCockpit(payload({ alerts }));

  const toggles = await screen.findAllByRole("button", { expanded: false, name: /Nahdi Medical/ });
  expect(toggles).toHaveLength(1);
  expect(toggles[0].textContent).toContain("10 events");
});

test("the newest observation of a company leads the card", async () => {
  const alerts = [alert(0), alert(5), alert(2)];
  renderCockpit(payload({ alerts }));

  const toggle = await screen.findByRole("button", { name: /Nahdi Medical/ });
  const region = toggle.closest("[data-code='4164']") as HTMLElement;

  // 10:15Z is the latest of 10:10Z, 10:15Z and 10:12Z; Riyadh is UTC+3.
  expect(region.textContent).toContain("Latest observed");
  expect(region.textContent).toContain("13:15");
  await userEvent.click(toggle);
  expect(within(region).getByText("Earlier observations (2)")).toBeTruthy();
});

test("the company name is primary and the code is secondary", async () => {
  renderCockpit(payload({ alerts: [alert(0)] }));

  const toggle = await screen.findByRole("button", { name: /Nahdi Medical/ });
  expect(toggle.textContent).toMatch(/Nahdi Medical\s*\(4164\)/);
  expect(toggle.querySelector("span")?.textContent).toBe("Nahdi Medical");
});

test("an unresolved code reads as unavailable rather than as a name", async () => {
  renderCockpit(payload({ alerts: [alert(0, { code: "9999", name: "Company name unavailable" })] }));

  const toggle = await screen.findByRole("button", { name: /Company name unavailable/ });
  expect(toggle.textContent).toContain("(9999)");
});

test("clicking an alert expands its evidence and delayed-data warning", async () => {
  renderCockpit(payload({ alerts: [alert(0), alert(1)] }));

  const toggle = await screen.findByRole("button", { name: /Nahdi Medical/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");

  await userEvent.click(toggle);

  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const details = document.getElementById(toggle.getAttribute("aria-controls") as string) as HTMLElement;
  expect(details.textContent).toContain("Delayed data");
  expect(within(details).getAllByText("Direction").length).toBeGreaterThan(0);
  expect(within(details).getAllByText("Excess movement").length).toBeGreaterThan(0);
  expect(within(details).getAllByText("Robust-Z score").length).toBeGreaterThan(0);
  expect(within(details).getAllByText("Volume").length).toBeGreaterThan(0);
  expect(details.textContent).toContain("Confirmed at 2.5× the median");
  expect(within(details).getAllByText("Observed").length).toBeGreaterThan(0);
  expect(within(details).getAllByText("Received").length).toBeGreaterThan(0);
  expect(details.textContent).toContain("Delayed bot confirmation of statistically unusual price movement.");
  expect(within(details).getByText("Earlier observations (1)")).toBeTruthy();
});

test("volume is omitted when the producer recorded none", async () => {
  const withoutVolume = alert(0);
  delete withoutVolume.volumeRatio;
  renderCockpit(payload({ alerts: [withoutVolume] }));

  await userEvent.click(await screen.findByRole("button", { name: /Nahdi Medical/ }));

  expect(screen.queryByText("Volume")).toBeNull();
});

test("the keyboard alone expands an alert", async () => {
  renderCockpit(payload({ alerts: [alert(0)] }));

  const toggle = await screen.findByRole("button", { name: /Nahdi Medical/ });
  toggle.focus();
  await userEvent.keyboard("{Enter}");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");

  await userEvent.keyboard(" ");
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

test("two companies stay separate and the newest company leads", async () => {
  const alerts = [alert(0), alert(6, { alertId: "jahez-1", code: "6017", name: "Jahez", direction: "downside" })];
  renderCockpit(payload({ alerts }));

  const cards = document.querySelectorAll("[data-code]");
  expect([...cards].map((card) => card.getAttribute("data-code"))).toEqual(["6017", "4164"]);
  expect(await screen.findByRole("button", { name: /Jahez/ })).toBeTruthy();
});

test("keeps earlier delayed alerts out of the current daily alert result", async () => {
  const current = alert(0, { observedAt: "2026-08-19T10:10:00Z", receivedAt: "2026-08-19T10:10:30Z" });
  const earlier = alert(1, { alertId: "jahez-earlier", code: "6017", name: "Jahez", observedAt: "2026-08-18T10:10:00Z", receivedAt: "2026-08-18T10:10:30Z" });
  renderCockpit(payload({ alerts: [current, earlier] }));

  const currentAlerts = await screen.findByLabelText("Current delayed alerts");
  expect(within(currentAlerts).getByRole("button", { name: /Nahdi Medical/ })).toBeTruthy();
  expect(within(currentAlerts).queryByRole("button", { name: /Jahez/ })).toBeNull();

  const earlierAlerts = screen.getByLabelText("Earlier delayed alerts");
  expect(earlierAlerts.textContent).toContain("Not from this daily snapshot");
  expect(within(earlierAlerts).getByRole("button", { name: /Jahez/ })).toBeTruthy();
});

test("explains when the current daily snapshot produced no movement alert", async () => {
  renderCockpit(payload({ alerts: [alert(0, { observedAt: "2026-08-18T10:10:00Z", receivedAt: "2026-08-18T10:10:30Z" })] }));

  const currentAlerts = await screen.findByLabelText("Current delayed alerts");
  expect(currentAlerts.textContent).toContain("No delayed movement alert was produced for this daily snapshot.");
});

test("an empty Top 10 offers no approval controls", async () => {
  renderCockpit(payload());

  await userEvent.click(screen.getByRole('button', { name: /Data status/ }));
  const top10 = document.querySelector("[data-label='Top 10']") as HTMLElement;

  expect(screen.queryByRole("button", { name: "Approve Top 10" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reject Top 10" })).toBeNull();
  expect(top10.textContent).toContain("nothing to approve or reject");
});

test("a researched Top 10 draft does offer approval controls", async () => {
  const entries = [{
    code: "4164",
    name: "Nahdi Medical",
    sector: "healthcare",
    owned: false,
    totalScore: 8.2,
    reasons: ["Evidence reviewed."],
    evidence: { source: "tadawul", observedAt: "2026-08-18T06:00:00Z", receivedAt: "2026-08-18T06:05:00Z", latency: "official-filing" as const, freshness: "current" as const },
  }];
  renderCockpit(payload({ snapshot: { ...snapshot, top10: { ...snapshot.top10, entries } } }));

  await userEvent.click(screen.getByRole('button', { name: /Data status/ }));

  expect(screen.getByRole("button", { name: "Approve Top 10" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reject Top 10" })).toBeTruthy();
});

test("diagnostics are behind Data status and retain withheld forecast explanations", async () => {
  renderCockpit(payload());
  expect(screen.queryByRole('heading', { name: 'Forecast' })).toBeNull();
  expect(screen.getByText(/No scanner candidates met both research conditions/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /Data status/ }));
  const forecast = document.querySelector("[data-label='Forecast']") as HTMLElement;
  expect(forecast.textContent).toContain("Forecast unavailable: validation gates have not passed.");
  expect(forecast.textContent).toContain('validation gates not passed.');
});

test("a stale snapshot still explains itself above the rail", async () => {
  renderCockpit(payload({ freshness: "stale" }));

  expect(await screen.findByLabelText("Stale data warning")).toBeTruthy();
  expect(screen.getByText(/The expected pre-open refresh did not arrive/)).toBeTruthy();
});

test("holdings precede research and movement history in the overview", async () => {
  renderCockpit(payload({ alerts: [alert(0)] }));

  const holdings = screen.getByRole('region', { name: 'My holdings' });
  const research = screen.getByRole('region', { name: 'Worth watching' });
  expect(holdings.compareDocumentPosition(research) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /Everything else/ })).toBeNull();
});

test("a keyboard-accessible chart expands from the canonical three-month data", async () => {
  render(<PriceVolumeChart chart={canonicalSnapshot.charts[0]} />);

  const toggle = await screen.findByRole("button", { name: /Show 3-month chart for Nahdi Medical/i });
  toggle.focus();
  await userEvent.keyboard("{Enter}");

  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("img", { name: /Nahdi Medical 3-month price and volume chart/i })).toBeTruthy();
  expect(screen.getByText(/Stop 118.00/)).toBeTruthy();
});

test("a failed manual refresh retains the last-good cockpit view", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify(payload()), { headers: { "content-type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporary API failure" }), { status: 503, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ActionCockpit dashboard={payload()} />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh cockpit' }).hasAttribute('disabled')).toBe(false));
  await userEvent.click(screen.getByRole("button", { name: "Refresh cockpit" }));

  expect((await screen.findByRole("status")).textContent).toMatch(/Refresh failed/i);
  expect(screen.getByRole('heading', { name: /A little clarity/ })).toBeTruthy();
});
