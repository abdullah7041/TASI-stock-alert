import type { D1Database } from "cloudflare:workers";
import { researchSchemaStatements } from "@/db/schema";
import { parseMarketPulse } from "@/app/lib/market-pulse-core.mjs";

export class MarketPulseStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ensureReady() { this.#ready ??= this.db.batch(researchSchemaStatements.map((sql) => this.db.prepare(sql))).then(() => undefined); return this.#ready; }
  async save(pulse: ReturnType<typeof parseMarketPulse>) {
    await this.ensureReady();
    const observedAt = "observedAt" in pulse ? pulse.observedAt : null;
    await this.db.prepare("INSERT INTO market_pulses (pulse_key,pulse_json,status,observed_at,updated_at) VALUES ('latest',?,?,?,?) ON CONFLICT(pulse_key) DO UPDATE SET pulse_json=excluded.pulse_json,status=excluded.status,observed_at=excluded.observed_at,updated_at=excluded.updated_at")
      .bind(JSON.stringify(pulse), pulse.status, observedAt, new Date().toISOString()).run();
  }
  async latest() {
    await this.ensureReady();
    const row = await this.db.prepare("SELECT pulse_json FROM market_pulses WHERE pulse_key = 'latest'").first<{ pulse_json: string }>();
    return row ? parseMarketPulse(JSON.parse(row.pulse_json)) : null;
  }
}
