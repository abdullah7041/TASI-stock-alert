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
  `CREATE UNIQUE INDEX IF NOT EXISTS one_opening_balance_per_owner ON portfolio_events(owner_id) WHERE event_kind = 'opening_balance'`,
  `CREATE TRIGGER IF NOT EXISTS portfolio_prevent_overspend
    BEFORE INSERT ON portfolio_events
    WHEN NEW.event_kind = 'buy'
    BEGIN
      SELECT CASE WHEN COALESCE((
        SELECT SUM(CASE
          WHEN event_kind IN ('opening_balance', 'contribution', 'cash_adjustment') THEN COALESCE(cash_sar, 0)
          WHEN event_kind = 'sell' THEN COALESCE(shares, 0) * COALESCE(price_sar, 0) - COALESCE(fees_sar, 0)
          WHEN event_kind = 'buy' THEN -(COALESCE(shares, 0) * COALESCE(price_sar, 0) + COALESCE(fees_sar, 0))
          ELSE 0 END)
        FROM portfolio_events WHERE owner_id = NEW.owner_id
      ), 0) < NEW.shares * NEW.price_sar + COALESCE(NEW.fees_sar, 0)
      THEN RAISE(ABORT, 'buy exceeds confirmed cash') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS portfolio_prevent_oversell
    BEFORE INSERT ON portfolio_events
    WHEN NEW.event_kind = 'sell'
    BEGIN
      SELECT CASE WHEN COALESCE((
        SELECT SUM(CASE
          WHEN event_kind IN ('opening_position', 'buy') THEN COALESCE(shares, 0)
          WHEN event_kind = 'sell' THEN -COALESCE(shares, 0)
          ELSE 0 END)
        FROM portfolio_events WHERE owner_id = NEW.owner_id AND symbol = NEW.symbol
      ), 0) < NEW.shares
      THEN RAISE(ABORT, 'sell exceeds confirmed holding') END;
    END`,
  `CREATE TRIGGER IF NOT EXISTS portfolio_require_monotonic_time
    BEFORE INSERT ON portfolio_events
    WHEN NEW.event_kind NOT IN ('opening_balance', 'opening_position')
    BEGIN
      SELECT CASE WHEN EXISTS(
        SELECT 1 FROM portfolio_events
        WHERE owner_id = NEW.owner_id AND confirmed_at >= NEW.confirmed_at
      ) THEN RAISE(ABORT, 'confirmedAt must be later than the previous event') END;
    END`,
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
];
