import type { D1Database } from "cloudflare:workers";
import { parseDashboardSnapshot } from "@/app/lib/dashboard-core.mjs";
import { dashboardSnapshotKey, dashboardSnapshotReadKeys } from "@/app/lib/dashboard-storage-core.mjs";

export class DashboardStore {
  #ready: Promise<void> | undefined;
  constructor(private readonly db: D1Database) {}
  async ensureReady() {
    this.#ready ??= this.db.prepare("CREATE TABLE IF NOT EXISTS dashboard_snapshots (snapshot_key TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, updated_at TEXT NOT NULL)").run().then(() => undefined);
    return this.#ready;
  }
  async latest() {
    await this.ensureReady();
    for (const key of dashboardSnapshotReadKeys()) {
      const row = await this.db.prepare("SELECT snapshot_json FROM dashboard_snapshots WHERE snapshot_key = ?").bind(key).first<{ snapshot_json: string }>();
      if (row) return parseDashboardSnapshot(JSON.parse(row.snapshot_json));
    }
    return null;
  }
  async save(snapshot: ReturnType<typeof parseDashboardSnapshot>) {
    await this.ensureReady();
    await this.db.prepare("INSERT INTO dashboard_snapshots (snapshot_key, snapshot_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(snapshot_key) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at").bind(dashboardSnapshotKey(snapshot.schemaVersion), JSON.stringify(snapshot), new Date().toISOString()).run();
  }
}
