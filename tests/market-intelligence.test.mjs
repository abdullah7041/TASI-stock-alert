import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketIntelligence } from "../app/lib/market-intelligence.mjs";

const officialHeadline = {
  title: "Insurance investment-rule draft published",
  link: "https://www.ia.gov.sa/regulations/investment-draft",
  published: "2026-09-16T06:08:00Z",
};

function snapshot(records) {
  return { tradeDate: "2026-09-16", digestRecords: records };
}

test("groups one verified headline across related stocks without claiming causation", () => {
  const view = buildMarketIntelligence(snapshot([
    { code: "8200", name: "Saudi Re", priceDate: "2026-09-16", delta: { price_pct: 9.97 }, news: { ok: true, status: "available", headlines: [officialHeadline] } },
    { code: "8010", name: "Tawuniya", priceDate: "2026-09-16", delta: { price_pct: 4.36 }, news: { ok: true, status: "available", headlines: [officialHeadline] } },
  ]), []);

  assert.equal(view.events.length, 1);
  assert.equal(view.events[0].verification, "verified");
  assert.equal(view.events[0].causation, "not-proven");
  assert.equal(view.events[0].reactionWindow, "daily-close");
  assert.deepEqual(view.events[0].related.map((item) => item.code), ["8200", "8010"]);
  assert.deepEqual(view.events[0].breadth, { positive: 2, negative: 0, unavailable: 0 });
});

test("does not promote a social discovery lead into a verified event", () => {
  const view = buildMarketIntelligence(snapshot([
    { code: "8200", name: "Saudi Re", delta: { price_pct: 9.97 }, news: { ok: true, status: "available", headlines: [{ title: "Insurance stocks may react", link: "https://x.com/SenseiFund/status/1", published: "2026-09-16T06:00:00Z" }] } },
  ]), []);

  assert.deepEqual(view.events, []);
});

test("keeps an unusual move with no timely verified news unexplained", () => {
  const view = buildMarketIntelligence(snapshot([
    { code: "1303", name: "EIC", news: { ok: true, status: "empty", headlines: [] } },
  ]), [{
    alertId: "alert-1", code: "1303", name: "EIC", direction: "downside",
    observedAt: "2026-09-16T08:20:00Z", receivedAt: "2026-09-16T08:25:00Z",
    latency: "delayed-intraday", excessMovePct: -4.7, robustZ: -4.6, volumeRatio: 1.5,
    reason: "Delayed bot confirmation of statistically unusual price movement.",
  }]);

  assert.equal(view.anomalies.length, 1);
  assert.equal(view.anomalies[0].status, "unexplained");
  assert.equal(view.anomalies[0].volumeConfirmed, false);
  assert.match(view.anomalies[0].explanation, /No timely verified news/);
});

test("keeps failed news retrieval distinct from a verified empty result", () => {
  const view = buildMarketIntelligence(snapshot([
    { code: "1303", name: "EIC", news: { ok: false, status: "failed", errors: ["timeout"] } },
  ]), [{
    alertId: "alert-2", code: "1303", name: "EIC", direction: "upside",
    observedAt: "2026-09-16T09:20:00Z", receivedAt: "2026-09-16T09:25:00Z",
    latency: "delayed-intraday", excessMovePct: 3.2, robustZ: 4.2, volumeRatio: 2.4,
    reason: "Delayed bot confirmation of statistically unusual price movement.",
  }]);

  assert.equal(view.anomalies[0].newsStatus, "failed");
  assert.match(view.anomalies[0].explanation, /retrieval failed/);
});
