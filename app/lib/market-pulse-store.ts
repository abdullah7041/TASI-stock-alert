import type { D1Database } from "cloudflare:workers";
import { parseMarketPulse } from "@/app/lib/market-pulse-core.mjs";

export class MarketPulseStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}

  async ensureReady() {
    this.#ready ??= this.db.prepare(
      "CREATE TABLE IF NOT EXISTS market_pulses (pulse_key TEXT PRIMARY KEY, pulse_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
    ).run().then(() => undefined);
    return this.#ready;
  }

  async latest() {
    await this.ensureReady();
    const row = await this.db.prepare(
      "SELECT pulse_json FROM market_pulses WHERE pulse_key = ?",
    ).bind("latest").first<{ pulse_json: string }>();
    return row ? parseMarketPulse(JSON.parse(row.pulse_json)) : null;
  }

  async save(pulse: ReturnType<typeof parseMarketPulse>) {
    await this.ensureReady();
    await this.db.prepare(
      "INSERT INTO market_pulses (pulse_key, pulse_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(pulse_key) DO UPDATE SET pulse_json = excluded.pulse_json, updated_at = excluded.updated_at",
    ).bind("latest", JSON.stringify(pulse), new Date().toISOString()).run();
  }
}
