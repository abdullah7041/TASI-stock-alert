export const researchSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS agent_reports (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    trade_date TEXT NOT NULL,
    status TEXT NOT NULL,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_id, symbol, trade_date)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_usage (
    owner_id TEXT NOT NULL,
    month_key TEXT NOT NULL,
    operation_key TEXT NOT NULL,
    cost_sar REAL NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(owner_id, operation_key)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    message_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];
