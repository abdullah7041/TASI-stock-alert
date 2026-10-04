import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { buildMarketPulse, collectYahoo, extractYahooBars, runPulse, selectTrackedCodes } from "../cloudflare-pulse/core.mjs";
import { LIVE_HOLDINGS_SQL, runScheduledPulse } from "../cloudflare-pulse/index.mjs";

const at = "2026-09-22T07:20:00Z";
const bars = (before = 100, after = 101) => [
  { at: "2026-09-22T07:10:00Z", close: before },
  { at: "2026-09-22T07:15:00Z", close: after },
  { at: "2026-09-22T07:20:00Z", close: 999 },
];
const daily = Array.from({ length: 52 }, (_, i) => ({ at: new Date(Date.UTC(2026, 6, 1 + i)).toISOString(), close: 10_000 + i }));

test("a fully sold holding leaves the pulse universe even when its original row has positive shares", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE portfolio_events (owner_id TEXT,event_kind TEXT,symbol TEXT,shares INTEGER)");
  db.prepare("INSERT INTO portfolio_events VALUES (?,?,?,?)").run("owner","opening_position","1303",5);
  db.prepare("INSERT INTO portfolio_events VALUES (?,?,?,?)").run("owner","sell","1303",5);
  db.prepare("INSERT INTO portfolio_events VALUES (?,?,?,?)").run("owner","opening_position","2320",12);
  assert.deepEqual(db.prepare(LIVE_HOLDINGS_SQL).all("owner").map(({code,shares})=>({code,shares})),[{code:"2320",shares:12}]);
  db.close();
});

test("the shadow collector tracks holdings, daily watchlist, and only approved Top 10 entries", () => {
  const snapshot = {
    portfolio: { holdings: [{ code: "1303" }, { code: "2320" }] },
    digestRecords: [{ code: "4164", kind: "watchlist" }, { code: "1303", kind: "holding" }],
  };
  assert.deepEqual(selectTrackedCodes(snapshot, { status: "approved", entries: [{ code: "6017" }, { code: "1303" }] }), ["1303", "2320", "4164", "6017"]);
  assert.deepEqual(selectTrackedCodes(snapshot, { status: "draft", entries: [{ code: "9999" }] }), ["1303", "2320", "4164"]);
});

test("Yahoo chart qualification rejects a mismatched source and keeps only positive closes", () => {
  const payload = { chart: { error: null, result: [{
    meta: { symbol: "1303.SR", currency: "SAR", exchangeName: "SAU", exchangeTimezoneName: "Asia/Riyadh", dataGranularity: "5m" },
    timestamp: [Date.parse("2026-09-22T07:10:00Z") / 1000, Date.parse("2026-09-22T07:15:00Z") / 1000],
    indicators: { quote: [{ close: [15.1, null] }] },
  }] } };
  assert.deepEqual(extractYahooBars(payload, "1303.SR", "5m"), [{ at: "2026-09-22T07:10:00.000Z", close: 15.1 }]);
  assert.throws(() => extractYahooBars(payload, "2320.SR", "5m"), /symbol/i);
  assert.throws(() => extractYahooBars(payload, "1303.SR", "1d"), /interval/i);
});

test("a current pulse requires a completed index bar and at least seventy percent tracked coverage", () => {
  const pulse = buildMarketPulse({
    frames: { "^TASI.SR": bars(11000, 11010), "1303": bars(15, 15.3), "2320": bars(60, 60.1), "4164": bars(90, 90.2) },
    daily, tracked: ["1303", "2320", "4164", "6017"], fetchedAt: at,
  });
  assert.equal(pulse.status, "current");
  assert.deepEqual(pulse.coverage, { tracked: 4, usable: 3, required: 3 });
  assert.equal(pulse.index.latestBarAt, "2026-09-22T07:15:00Z");
  assert.equal(pulse.observations.find((item) => item.code === "1303").price, 15.3);
  assert.deepEqual(pulse.regime, { status: "available", label: "ok", bars: 52 });
  const below = buildMarketPulse({ frames: { "^TASI.SR": bars(), "1303": bars(), "2320": bars() }, daily, tracked: ["1303", "2320", "4164"], fetchedAt: at });
  assert.equal(below.status, "unavailable");
  assert.deepEqual(below.coverage, { tracked: 3, usable: 2, required: 3 });
});

test("a failed source preserves the last valid observation as stale without inventing a regime", () => {
  const prior = buildMarketPulse({ frames: { "^TASI.SR": bars(), "1303": bars() }, daily: [], tracked: ["1303"], fetchedAt: at });
  assert.equal(prior.regime.status, "unavailable");
  assert.match(prior.regime.reason, /52 are required/);
  const failed = buildMarketPulse({ frames: {}, daily: [], tracked: ["1303"], fetchedAt: "2026-09-22T07:25:00Z", prior });
  assert.equal(failed.status, "stale");
  assert.equal(failed.lastValidAt, at);
  assert.equal(failed.index.latestBarAt, "2026-09-22T07:15:00Z");
  assert.equal(failed.observations[0].price, 101);
  assert.equal(failed.regime.status, "unavailable");
});

test("the Yahoo adapter rejects a mismatched stock without counting it toward coverage", async () => {
  const chart = (symbol, interval) => ({ chart: { error: null, result: [{
    meta: { symbol, currency: "SAR", exchangeName: "SAU", exchangeTimezoneName: "Asia/Riyadh", dataGranularity: interval },
    timestamp: [Date.parse("2026-09-22T07:10:00Z") / 1000, Date.parse("2026-09-22T07:15:00Z") / 1000],
    indicators: { quote: [{ close: [100, 101] }] },
  }] } });
  const fetcher = async (url) => {
    const symbol = decodeURIComponent(new URL(url).pathname.split("/").at(-1));
    return Response.json(chart(symbol === "2320.SR" ? "9999.SR" : symbol, new URL(url).searchParams.get("interval")));
  };
  const collected = await collectYahoo(["1303", "2320"], fetcher);
  assert.equal(collected.frames["1303"].length, 2);
  assert.equal(collected.frames["2320"], undefined);
  assert.match(collected.errors.join(" "), /2320.*symbol/i);
});

test("a shadow run persists an attempt without publishing a pulse", async () => {
  const saved = [], published = [];
  const pulse = await runPulse({
    tracked: ["1303"], prior: null, fetchedAt: at, publicationEnabled: false,
    collect: async () => ({ frames: { "^TASI.SR": bars(), "1303": bars() }, daily: [], errors: [] }),
    saveAttempt: async (value) => { saved.push(value); },
    publish: async (value) => { published.push(value); },
  });
  assert.equal(pulse.status, "current");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].status, "current");
  assert.deepEqual(published, []);
});

test("a transport failure is named in the unavailable reason instead of looking like empty market data", async () => {
  const pulse = await runPulse({
    tracked: ["1303"], prior: null, fetchedAt: at, publicationEnabled: false,
    collect: async () => ({ frames: {}, daily: [], errors: ["^TASI.SR: HTTP 429"] }),
    saveAttempt: async () => {}, publish: async () => { throw new Error("shadow published"); },
  });
  assert.equal(pulse.status, "unavailable");
  assert.match(pulse.reason, /source fetch failed/i);
  assert.match(pulse.reason, /HTTP 429/i);
});

test("the Cloudflare scheduled run saves a shadow attempt in D1 without touching the published pulse", async () => {
  const writes = { attempts: [], published: [] };
  const snapshot = { portfolio: { holdings: [{ code: "1303" }] }, digestRecords: [] };
  const db = { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() {
        if (sql.includes("FROM dashboard_snapshots")) return { snapshot_json: JSON.stringify(snapshot) };
        return null;
      },
      async all() { return { results: [] }; },
      async run() {
        if (sql.includes("INSERT INTO observational_market_pulse_attempts")) writes.attempts.push(JSON.parse(args[2]));
        if (sql.includes("INSERT INTO observational_market_pulses")) writes.published.push(JSON.parse(args[0]));
        return { success: true };
      },
    };
  } };
  const chart = (symbol, interval) => ({ chart: { error: null, result: [{
    meta: { symbol, currency: "SAR", exchangeName: "SAU", exchangeTimezoneName: "Asia/Riyadh", dataGranularity: interval },
    timestamp: [Date.parse("2026-09-22T07:10:00Z") / 1000, Date.parse("2026-09-22T07:15:00Z") / 1000],
    indicators: { quote: [{ close: [100, 101] }] },
  }] } });
  const fetcher = async (url) => Response.json(chart(decodeURIComponent(new URL(url).pathname.split("/").at(-1)), new URL(url).searchParams.get("interval")));
  const result = await runScheduledPulse({ DB: db, TASI_PULSE_PUBLICATION_ENABLED: "false" }, { scheduledAt: at, fetchedAt: at, fetcher });
  assert.equal(result.status, "current");
  assert.equal(writes.attempts[0].status, "current");
  assert.deepEqual(writes.published, []);
});
