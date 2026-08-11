import type { D1Database } from "cloudflare:workers";
import { parseDashboardSnapshot } from "@/app/lib/dashboard-core.mjs";
import type { DashboardSnapshot } from "@/app/lib/dashboard-types";

export class DashboardStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ensureReady() {
    this.#ready ??= this.db.prepare("CREATE TABLE IF NOT EXISTS dashboard_snapshots (snapshot_key TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, updated_at TEXT NOT NULL)").run().then(() => undefined);
    return this.#ready;
  }
  async latest(): Promise<DashboardSnapshot | null> {
    await this.ensureReady();
    const row = await this.db.prepare("SELECT snapshot_json FROM dashboard_snapshots WHERE snapshot_key = 'latest'").first<{ snapshot_json: string }>();
    return row ? parseDashboardSnapshot(JSON.parse(row.snapshot_json)) as DashboardSnapshot : null;
  }
  async save(snapshot: DashboardSnapshot) {
    await this.ensureReady();
    await this.db.prepare("INSERT INTO dashboard_snapshots (snapshot_key, snapshot_json, updated_at) VALUES ('latest', ?, ?) ON CONFLICT(snapshot_key) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at").bind(JSON.stringify(snapshot), new Date().toISOString()).run();
  }
}
