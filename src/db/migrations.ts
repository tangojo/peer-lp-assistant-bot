import type { Database } from 'sql.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('migrations');

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS deposits (
        id INTEGER PRIMARY KEY,
        deposit_id INTEGER NOT NULL,
        wallet_address TEXT NOT NULL,
        chain TEXT DEFAULT 'base',
        token TEXT DEFAULT 'USDC',
        amount_deposited REAL,
        amount_available REAL,
        spread_percent REAL,
        payment_method TEXT,
        currency TEXT DEFAULT 'EUR',
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY,
        intent_hash TEXT UNIQUE NOT NULL,
        deposit_id INTEGER NOT NULL,
        buyer_address TEXT,
        usdc_amount REAL,
        fiat_amount REAL,
        fiat_currency TEXT DEFAULT 'EUR',
        conversion_rate REAL,
        status TEXT DEFAULT 'signaled',
        signaled_at DATETIME,
        locked_at DATETIME,
        fulfilled_at DATETIME,
        fill_time_seconds INTEGER,
        tx_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cycles (
        id INTEGER PRIMARY KEY,
        deposit_id INTEGER,
        usdc_sold REAL,
        fiat_received REAL,
        fiat_currency TEXT DEFAULT 'EUR',
        spread_earned_percent REAL,
        recycling_cost_percent REAL,
        net_profit_fiat REAL,
        net_profit_usd REAL,
        eur_usd_rate REAL,
        status TEXT DEFAULT 'open',
        started_at DATETIME,
        completed_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS revolut_transactions (
        id INTEGER PRIMARY KEY,
        revolut_tx_id TEXT UNIQUE,
        amount REAL,
        currency TEXT,
        counterparty TEXT,
        reference TEXT,
        matched_order_id INTEGER,
        received_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (matched_order_id) REFERENCES orders(id)
      );

      CREATE TABLE IF NOT EXISTS forex_snapshots (
        id INTEGER PRIMARY KEY,
        eur_usd REAL,
        source TEXT,
        captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS spread_history (
        id INTEGER PRIMARY KEY,
        deposit_id INTEGER,
        old_spread REAL,
        new_spread REAL,
        reason TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );

      INSERT INTO schema_version (version) VALUES (1);
    `,
  },
];

export function runMigrations(db: Database): void {
  // Check current schema version
  let currentVersion = 0;

  try {
    const result = db.exec('SELECT MAX(version) as v FROM schema_version');
    if (result.length > 0 && result[0].values.length > 0) {
      currentVersion = (result[0].values[0][0] as number) ?? 0;
    }
  } catch {
    // Table doesn't exist yet — version 0
  }

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    log.debug({ currentVersion }, 'Database schema up to date');
    return;
  }

  for (const migration of pending) {
    log.info({ from: currentVersion, to: migration.version }, 'Running migration');
    db.run(migration.sql);
    currentVersion = migration.version;
  }

  log.info({ version: currentVersion }, 'Migrations complete');
}
