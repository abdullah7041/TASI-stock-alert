// Local-only preview data. Never connects to a remote database.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const snapshot = JSON.parse(readFileSync('tests/fixtures/friendly-dashboard.json', 'utf8'));
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
mkdirSync('.tmp', { recursive: true });
const json = JSON.stringify(snapshot);
const statements = [`CREATE TABLE IF NOT EXISTS dashboard_snapshots (snapshot_key TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, updated_at TEXT NOT NULL);`,
  `INSERT OR REPLACE INTO dashboard_snapshots VALUES ('latest-v3', '', ${quote(snapshot.asOf)});`];
for (let offset = 0; offset < json.length; offset += 10000) statements.push(`UPDATE dashboard_snapshots SET snapshot_json = snapshot_json || ${quote(json.slice(offset, offset + 10000))} WHERE snapshot_key = 'latest-v3';`);
writeFileSync('.tmp/preview.sql', statements.join('\n'));
