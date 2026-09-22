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
  `CREATE TABLE IF NOT EXISTS portfolio_events (
    operation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, event_kind TEXT NOT NULL,
    month_key TEXT, symbol TEXT, name TEXT, shares INTEGER, price_sar REAL,
    cash_sar REAL, fees_sar REAL NOT NULL DEFAULT 0, reason TEXT, confirmed_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_contribution_per_owner_month ON portfolio_events(owner_id, month_key) WHERE event_kind = 'contribution'`,
  `CREATE TABLE IF NOT EXISTS top10_proposals (
    proposal_id TEXT PRIMARY KEY, trade_date TEXT NOT NULL, researched_at TEXT NOT NULL,
    proposal_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','approved','rejected')), decided_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS one_approved_top10 ON top10_proposals(status) WHERE status = 'approved'`,
  `CREATE TABLE IF NOT EXISTS movement_alerts (
    alert_id TEXT PRIMARY KEY, symbol TEXT NOT NULL, direction TEXT NOT NULL, observed_at TEXT NOT NULL,
    alert_json TEXT NOT NULL, delivery_state TEXT NOT NULL DEFAULT 'pending'
  )`,
  `CREATE TABLE IF NOT EXISTS artifact_deliveries (
    artifact_id TEXT NOT NULL,
    destination TEXT NOT NULL CHECK(destination IN ('discord','cockpit')),
    status TEXT NOT NULL CHECK(status IN ('success','failure')),
    attempted_at TEXT NOT NULL,
    error_detail TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(artifact_id, destination)
  )`,
  `CREATE TABLE IF NOT EXISTS market_pulses (
    pulse_key TEXT PRIMARY KEY, pulse_json TEXT NOT NULL, status TEXT NOT NULL,
    observed_at TEXT, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS evidence_queue (
    source_url TEXT PRIMARY KEY, announcement_json TEXT NOT NULL, collected_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS evidence_records (
    revision_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, symbol TEXT NOT NULL,
    report_period TEXT NOT NULL, evidence_json TEXT NOT NULL, reviewed_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS evidence_records_current ON evidence_records(symbol, report_period, reviewed_at DESC)`,
];
