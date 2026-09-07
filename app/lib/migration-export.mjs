const tables = new Set(['agent_messages', 'agent_reports', 'agent_usage', 'artifact_deliveries', 'dashboard_snapshots', 'movement_alerts', 'portfolio_events', 'top10_proposals']);

export async function exportPage(db, table, offset = 0) {
  if (!tables.has(table)) throw new Error('Unknown export table');
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid export offset');
  const schema = await db.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('table', 'index') AND sql IS NOT NULL ORDER BY type DESC, name").bind(table).all();
  const result = await db.prepare(`SELECT * FROM "${table}" ORDER BY rowid LIMIT 11 OFFSET ?`).bind(offset).all();
  return { table, schema: schema.results, rows: result.results.slice(0, 10), nextOffset: result.results.length > 10 ? offset + 10 : null };
}
