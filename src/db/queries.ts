import { getDb, saveDatabase } from './connection.js';

// --- Deposits ---

export function upsertDeposit(deposit: {
  deposit_id: number;
  wallet_address: string;
  amount_available?: number;
  spread_percent?: number;
  payment_method?: string;
  currency?: string;
  status?: string;
}): void {
  const db = getDb();
  db.run(
    `INSERT INTO deposits (deposit_id, wallet_address, amount_available, spread_percent, payment_method, currency, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(deposit_id) DO UPDATE SET
       amount_available = COALESCE(excluded.amount_available, deposits.amount_available),
       spread_percent = COALESCE(excluded.spread_percent, deposits.spread_percent),
       status = COALESCE(excluded.status, deposits.status),
       updated_at = datetime('now')`,
    [
      deposit.deposit_id,
      deposit.wallet_address,
      deposit.amount_available ?? null,
      deposit.spread_percent ?? null,
      deposit.payment_method ?? 'revolut',
      deposit.currency ?? 'EUR',
      deposit.status ?? 'active',
    ],
  );
  saveDatabase();
}

export function getDeposits(): Record<string, unknown>[] {
  const db = getDb();
  const result = db.exec('SELECT * FROM deposits ORDER BY deposit_id');
  return resultToObjects(result);
}

export function getDeposit(depositId: number): Record<string, unknown> | undefined {
  const db = getDb();
  const result = db.exec('SELECT * FROM deposits WHERE deposit_id = ?', [depositId]);
  const rows = resultToObjects(result);
  return rows[0];
}

// --- Orders ---

export function insertOrder(order: {
  intent_hash: string;
  deposit_id: number;
  buyer_address?: string;
  usdc_amount?: number;
  fiat_amount?: number;
  conversion_rate?: number;
  status: string;
  signaled_at?: string;
  tx_hash?: string;
}): void {
  const db = getDb();
  db.run(
    `INSERT OR IGNORE INTO orders (intent_hash, deposit_id, buyer_address, usdc_amount, fiat_amount, conversion_rate, status, signaled_at, tx_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.intent_hash,
      order.deposit_id,
      order.buyer_address ?? null,
      order.usdc_amount ?? null,
      order.fiat_amount ?? null,
      order.conversion_rate ?? null,
      order.status,
      order.signaled_at ?? new Date().toISOString(),
      order.tx_hash ?? null,
    ],
  );
  saveDatabase();
}

export function updateOrderStatus(
  intentHash: string,
  status: string,
  extra?: { locked_at?: string; fulfilled_at?: string; fill_time_seconds?: number; tx_hash?: string },
): void {
  const db = getDb();
  const sets = ['status = ?'];
  const params: unknown[] = [status];

  if (extra?.locked_at) {
    sets.push('locked_at = ?');
    params.push(extra.locked_at);
  }
  if (extra?.fulfilled_at) {
    sets.push('fulfilled_at = ?');
    params.push(extra.fulfilled_at);
  }
  if (extra?.fill_time_seconds != null) {
    sets.push('fill_time_seconds = ?');
    params.push(extra.fill_time_seconds);
  }
  if (extra?.tx_hash) {
    sets.push('tx_hash = ?');
    params.push(extra.tx_hash);
  }

  params.push(intentHash);
  db.run(`UPDATE orders SET ${sets.join(', ')} WHERE intent_hash = ?`, params);
  saveDatabase();
}

export function getOrders(limit = 20): Record<string, unknown>[] {
  const db = getDb();
  const result = db.exec('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?', [limit]);
  return resultToObjects(result);
}

export function getOrderByHash(intentHash: string): Record<string, unknown> | undefined {
  const db = getDb();
  const result = db.exec('SELECT * FROM orders WHERE intent_hash = ?', [intentHash]);
  const rows = resultToObjects(result);
  return rows[0];
}

export function getOrderStats(): { total: number; fulfilled: number; avgFillTime: number | null } {
  const db = getDb();
  const total = db.exec('SELECT COUNT(*) FROM orders');
  const fulfilled = db.exec("SELECT COUNT(*) FROM orders WHERE status = 'fulfilled'");
  const avgFill = db.exec("SELECT AVG(fill_time_seconds) FROM orders WHERE fill_time_seconds IS NOT NULL");

  return {
    total: (total[0]?.values[0]?.[0] as number) ?? 0,
    fulfilled: (fulfilled[0]?.values[0]?.[0] as number) ?? 0,
    avgFillTime: (avgFill[0]?.values[0]?.[0] as number) ?? null,
  };
}

// --- Forex ---

export function insertForexSnapshot(eurUsd: number, source: string): void {
  const db = getDb();
  db.run('INSERT INTO forex_snapshots (eur_usd, source) VALUES (?, ?)', [eurUsd, source]);
  saveDatabase();
}

export function getLatestForex(): { eur_usd: number; source: string; captured_at: string } | undefined {
  const db = getDb();
  const result = db.exec('SELECT eur_usd, source, captured_at FROM forex_snapshots ORDER BY captured_at DESC LIMIT 1');
  const rows = resultToObjects(result);
  return rows[0] as { eur_usd: number; source: string; captured_at: string } | undefined;
}

// --- Spread History ---

export function insertSpreadChange(depositId: number, oldSpread: number, newSpread: number, reason: string): void {
  const db = getDb();
  db.run(
    'INSERT INTO spread_history (deposit_id, old_spread, new_spread, reason) VALUES (?, ?, ?, ?)',
    [depositId, oldSpread, newSpread, reason],
  );
  saveDatabase();
}

// --- Helpers ---

function resultToObjects(result: { columns: string[]; values: unknown[][] }[]): Record<string, unknown>[] {
  if (result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}
