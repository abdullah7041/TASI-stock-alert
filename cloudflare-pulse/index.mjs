import { collectYahoo, runPulse, selectTrackedCodes } from "./core.mjs";
import { parseObservationalPulse } from "../app/lib/observational-pulse-core.mjs";

const ATTEMPTS_TABLE = `CREATE TABLE IF NOT EXISTS observational_market_pulse_attempts (
  scheduled_at TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, attempt_json TEXT NOT NULL,
  status TEXT NOT NULL, error_json TEXT NOT NULL, recorded_at TEXT NOT NULL
)`;

export const LIVE_HOLDINGS_SQL = `SELECT symbol AS code,
  SUM(CASE WHEN event_kind = 'sell' THEN -shares ELSE shares END) AS shares
  FROM portfolio_events WHERE owner_id = ? AND event_kind IN ('opening_position','buy','sell')
  AND symbol IS NOT NULL GROUP BY symbol
  HAVING SUM(CASE WHEN event_kind = 'sell' THEN -shares ELSE shares END) > 0`;

async function readSnapshot(db) {
  for (const key of ["latest-v3", "latest-v2"]) {
    try {
      const row = await db.prepare("SELECT snapshot_json FROM dashboard_snapshots WHERE snapshot_key = ?").bind(key).first();
      if (row) return JSON.parse(row.snapshot_json);
    } catch (error) {
      console.error(JSON.stringify({ event: "pulse-universe-snapshot-error", message: error instanceof Error ? error.message : String(error) }));
      break;
    }
  }
  return null;
}

async function readLedgerHoldings(db, fallback) {
  try {
    const owners = await db.prepare("SELECT DISTINCT owner_id FROM portfolio_events").all();
    if (owners.results.length > 1) throw new Error("Multiple portfolio owners; pulse universe cannot be qualified.");
    if (!owners.results.length) return fallback;
    const rows = await db.prepare(LIVE_HOLDINGS_SQL)
      .bind(owners.results[0].owner_id).all();
    return rows.results;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Multiple portfolio owners")) throw error;
    console.error(JSON.stringify({ event: "pulse-ledger-error", message: error instanceof Error ? error.message : String(error) }));
    return fallback;
  }
}

async function readApprovedTop10(db) {
  try {
    const row = await db.prepare("SELECT proposal_json FROM top10_proposals WHERE status = 'approved' ORDER BY decided_at DESC LIMIT 1").first();
    return row ? { ...JSON.parse(row.proposal_json), status: "approved" } : null;
  } catch (error) {
    console.error(JSON.stringify({ event: "pulse-top10-error", message: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

function inObservationWindow(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(get("weekday")) && minutes >= 10 * 60 && minutes <= 15 * 60 + 20;
}

export async function runScheduledPulse(env, { scheduledAt, fetchedAt, fetcher = fetch } = {}) {
  if (!env.DB) throw new Error("Pulse D1 binding is unavailable.");
  const db = env.DB;
  await db.prepare(ATTEMPTS_TABLE).run();
  const snapshot = await readSnapshot(db);
  const holdings = await readLedgerHoldings(db, snapshot?.portfolio?.holdings ?? []);
  const approved = await readApprovedTop10(db);
  const tracked = selectTrackedCodes({ ...snapshot, portfolio: { holdings } }, approved);
  const previous = await db.prepare("SELECT attempt_json FROM observational_market_pulse_attempts WHERE status = 'current' ORDER BY fetched_at DESC LIMIT 1").first();
  const prior = previous ? parseObservationalPulse(JSON.parse(previous.attempt_json)) : null;
  const pulse = await runPulse({
    tracked, prior, fetchedAt, publicationEnabled: env.TASI_PULSE_PUBLICATION_ENABLED === "true",
    collect: (codes) => collectYahoo(codes, fetcher),
    saveAttempt: async (attempt, errors) => {
      parseObservationalPulse(attempt);
      await db.prepare(`INSERT INTO observational_market_pulse_attempts
        (scheduled_at,fetched_at,attempt_json,status,error_json,recorded_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(scheduled_at) DO UPDATE SET fetched_at=excluded.fetched_at,
        attempt_json=excluded.attempt_json,status=excluded.status,error_json=excluded.error_json,recorded_at=excluded.recorded_at`)
        .bind(new Date(scheduledAt ?? Date.now()).toISOString(), attempt.fetchedAt, JSON.stringify(attempt), attempt.status,
          JSON.stringify(errors), new Date().toISOString()).run();
    },
    publish: async (attempt) => {
      await db.prepare(`INSERT INTO observational_market_pulses (pulse_key,pulse_json,status,observed_at,updated_at)
        VALUES ('latest',?,?,?,?) ON CONFLICT(pulse_key) DO UPDATE SET pulse_json=excluded.pulse_json,
        status=excluded.status,observed_at=excluded.observed_at,updated_at=excluded.updated_at`)
        .bind(JSON.stringify(attempt), attempt.status, attempt.observedAt ?? attempt.index?.latestBarAt ?? null, new Date().toISOString()).run();
    },
  });
  console.log(JSON.stringify({ event: "market-pulse-shadow", scheduledAt: new Date(scheduledAt ?? Date.now()).toISOString(),
    fetchedAt: pulse.fetchedAt, status: pulse.status, coverage: pulse.coverage,
    regime: pulse.regime.status, published: env.TASI_PULSE_PUBLICATION_ENABLED === "true" }));
  return pulse;
}

const worker = {
  async fetch() { return new Response("Not found.", { status: 404 }); },
  async scheduled(controller, env) {
    if (!inObservationWindow(controller.scheduledTime)) return;
    await runScheduledPulse(env, { scheduledAt: controller.scheduledTime });
  },
};

export default worker;
