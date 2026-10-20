export const SCHEMA = `
CREATE TABLE IF NOT EXISTS wallets (
  address TEXT PRIMARY KEY,
  funder_resolved INTEGER NOT NULL,
  funder TEXT,
  funding_signature TEXT,
  funding_amount_lamports TEXT,
  funded_at INTEGER,
  terminal TEXT,
  first_seen_at INTEGER,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tx_cache (
  signature TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  deployer TEXT NOT NULL,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS tokens_deployer ON tokens(deployer);
CREATE TABLE IF NOT EXISTS dev_tokens (
  deployer TEXT NOT NULL,
  mint TEXT NOT NULL,
  status TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (deployer, mint)
);
CREATE TABLE IF NOT EXISTS trace_wallets (
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  role TEXT NOT NULL,
  depth INTEGER NOT NULL,
  PRIMARY KEY (mint, wallet, role)
);
CREATE INDEX IF NOT EXISTS trace_wallets_wallet ON trace_wallets(wallet);
CREATE TABLE IF NOT EXISTS trace_results (
  mint TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  score INTEGER NOT NULL,
  finished_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trace_results_finished ON trace_results(finished_at);
CREATE TABLE IF NOT EXISTS early_buyers (
  mint TEXT NOT NULL,
  wallet TEXT NOT NULL,
  slot_offset INTEGER NOT NULL,
  PRIMARY KEY (mint, wallet)
);
CREATE INDEX IF NOT EXISTS early_buyers_wallet ON early_buyers(wallet);
CREATE TABLE IF NOT EXISTS trace_jobs (
  id TEXT PRIMARY KEY,
  mint TEXT NOT NULL,
  state TEXT NOT NULL,
  partial INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS trace_events (
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (job_id, seq)
);
CREATE TABLE IF NOT EXISTS feed_tokens (
  mint TEXT PRIMARY KEY,
  name TEXT,
  symbol TEXT,
  symbol_key TEXT,
  uri TEXT,
  creator TEXT NOT NULL,
  bonding_curve TEXT NOT NULL,
  create_signature TEXT,
  created_at INTEGER NOT NULL,
  initial_buy_sol REAL,
  mayhem INTEGER NOT NULL DEFAULT 0,
  market_cap_sol REAL,
  progress_pct REAL NOT NULL DEFAULT 0,
  peak_progress_pct REAL NOT NULL DEFAULT 0,
  real_sol REAL NOT NULL DEFAULT 0,
  complete INTEGER NOT NULL DEFAULT 0,
  migrated_at INTEGER,
  auto_traced_at INTEGER,
  polled_at INTEGER
);
CREATE INDEX IF NOT EXISTS feed_tokens_created ON feed_tokens(created_at);
CREATE INDEX IF NOT EXISTS feed_tokens_symbol ON feed_tokens(symbol_key, created_at);
CREATE INDEX IF NOT EXISTS feed_tokens_progress ON feed_tokens(progress_pct);
`;

/** Columns added after the first release; applied to databases created by older versions. */
export const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "wallets", column: "first_seen_at", ddl: "ALTER TABLE wallets ADD COLUMN first_seen_at INTEGER" },
];
