import { getDb, saveDatabase } from '../db/connection.js';
import { createChildLogger } from '../utils/logger.js';
import type { ForexPoller } from '../forex/poller.js';

const log = createChildLogger('pnl-tracker');

export interface CycleRecord {
  id: number;
  deposit_id: number;
  usdc_sold: number;
  fiat_received: number | null;
  fiat_currency: string;
  spread_earned_percent: number | null;
  recycling_cost_percent: number | null;
  net_profit_fiat: number | null;
  net_profit_usd: number | null;
  eur_usd_rate: number | null;
  status: string;
  started_at: string;
  completed_at: string | null;
}

export interface PnlSummary {
  period: string;
  totalCycles: number;
  completedCycles: number;
  totalUsdcSold: number;
  totalFiatReceived: number;
  totalNetProfitFiat: number;
  totalNetProfitUsd: number;
  avgSpreadPercent: number | null;
  avgFillTimeSeconds: number | null;
  annualizedReturnPercent: number | null;
}

export class PnlTracker {
  private forexPoller: ForexPoller;

  constructor(forexPoller: ForexPoller) {
    this.forexPoller = forexPoller;
  }

  start(): void {
    log.info('P&L tracker started');
  }

  /** Open a new cycle when an order is fulfilled */
  openCycle(depositId: number, usdcSold: number, spreadPercent: number): number {
    const db = getDb();
    const eurUsd = this.forexPoller.getRate();

    db.run(
      `INSERT INTO cycles (deposit_id, usdc_sold, spread_earned_percent, eur_usd_rate, status, started_at)
       VALUES (?, ?, ?, ?, 'open', datetime('now'))`,
      [depositId, usdcSold, spreadPercent, eurUsd],
    );
    saveDatabase();

    const result = db.exec('SELECT last_insert_rowid()');
    const cycleId = (result[0]?.values[0]?.[0] as number) ?? 0;

    log.info({ cycleId, depositId, usdcSold, spreadPercent }, 'Cycle opened');
    return cycleId;
  }

  /** Record fiat received for a cycle */
  recordFiatReceived(cycleId: number, fiatAmount: number, currency = 'EUR'): void {
    const db = getDb();
    db.run(
      `UPDATE cycles SET fiat_received = ?, fiat_currency = ?, status = 'fiat_received' WHERE id = ?`,
      [fiatAmount, currency, cycleId],
    );
    saveDatabase();
    log.info({ cycleId, fiatAmount, currency }, 'Fiat received recorded');
  }

  /** Close a cycle with final recycling costs and calculate net profit */
  closeCycle(cycleId: number, recyclingCostPercent: number): void {
    const db = getDb();
    const result = db.exec('SELECT * FROM cycles WHERE id = ?', [cycleId]);

    if (result.length === 0 || result[0].values.length === 0) {
      log.warn({ cycleId }, 'Cycle not found');
      return;
    }

    const cols = result[0].columns;
    const row = result[0].values[0];
    const cycle: Record<string, unknown> = {};
    cols.forEach((c, i) => { cycle[c] = row[i]; });

    const usdcSold = cycle.usdc_sold as number;
    const fiatReceived = cycle.fiat_received as number | null;
    const eurUsdRate = cycle.eur_usd_rate as number | null;

    let netProfitFiat: number | null = null;
    let netProfitUsd: number | null = null;

    if (fiatReceived != null && eurUsdRate != null) {
      const usdcValueInFiat = usdcSold / eurUsdRate;
      const recyclingCost = usdcValueInFiat * (recyclingCostPercent / 100);
      netProfitFiat = fiatReceived - usdcValueInFiat - recyclingCost;
      netProfitUsd = netProfitFiat * eurUsdRate;
    }

    db.run(
      `UPDATE cycles SET
        recycling_cost_percent = ?,
        net_profit_fiat = ?,
        net_profit_usd = ?,
        status = 'closed',
        completed_at = datetime('now')
       WHERE id = ?`,
      [recyclingCostPercent, netProfitFiat, netProfitUsd, cycleId],
    );
    saveDatabase();

    log.info({ cycleId, netProfitFiat, netProfitUsd, recyclingCostPercent }, 'Cycle closed');
  }

  /** Get P&L summary for a given period */
  getSummary(periodDays: number | null = null): PnlSummary {
    const db = getDb();

    let dateFilter = '';
    const params: unknown[] = [];
    let periodLabel = 'all-time';

    if (periodDays != null) {
      dateFilter = "AND started_at >= datetime('now', ?)";
      params.push(`-${periodDays} days`);
      periodLabel = `${periodDays}d`;
    }

    const totalResult = db.exec(
      `SELECT COUNT(*) FROM cycles WHERE 1=1 ${dateFilter}`,
      params,
    );
    const totalCycles = (totalResult[0]?.values[0]?.[0] as number) ?? 0;

    const closedResult = db.exec(
      `SELECT
        COUNT(*) as count,
        COALESCE(SUM(usdc_sold), 0) as total_usdc,
        COALESCE(SUM(fiat_received), 0) as total_fiat,
        COALESCE(SUM(net_profit_fiat), 0) as profit_fiat,
        COALESCE(SUM(net_profit_usd), 0) as profit_usd,
        AVG(spread_earned_percent) as avg_spread
       FROM cycles WHERE status = 'closed' ${dateFilter}`,
      params,
    );

    const closed = closedResult[0]?.values[0];
    const completedCycles = (closed?.[0] as number) ?? 0;
    const totalUsdcSold = (closed?.[1] as number) ?? 0;
    const totalFiatReceived = (closed?.[2] as number) ?? 0;
    const totalNetProfitFiat = (closed?.[3] as number) ?? 0;
    const totalNetProfitUsd = (closed?.[4] as number) ?? 0;
    const avgSpreadPercent = (closed?.[5] as number) ?? null;

    // Average fill time from orders table
    const fillResult = db.exec(
      `SELECT AVG(fill_time_seconds) FROM orders WHERE fill_time_seconds IS NOT NULL ${dateFilter.replace('started_at', 'signaled_at')}`,
      params,
    );
    const avgFillTimeSeconds = (fillResult[0]?.values[0]?.[0] as number) ?? null;

    // Annualized return: (profit / capital) * (365 / days)
    let annualizedReturnPercent: number | null = null;
    if (totalUsdcSold > 0 && periodDays != null && periodDays > 0) {
      const returnPercent = (totalNetProfitUsd / totalUsdcSold) * 100;
      annualizedReturnPercent = returnPercent * (365 / periodDays);
    }

    return {
      period: periodLabel,
      totalCycles,
      completedCycles,
      totalUsdcSold,
      totalFiatReceived,
      totalNetProfitFiat,
      totalNetProfitUsd,
      avgSpreadPercent,
      avgFillTimeSeconds,
      annualizedReturnPercent,
    };
  }

  /** Get open cycles */
  getOpenCycles(): CycleRecord[] {
    const db = getDb();
    const result = db.exec("SELECT * FROM cycles WHERE status != 'closed' ORDER BY started_at DESC");
    return resultToTyped(result);
  }

  /** Get recent closed cycles */
  getRecentCycles(limit = 10): CycleRecord[] {
    const db = getDb();
    const result = db.exec('SELECT * FROM cycles ORDER BY started_at DESC LIMIT ?', [limit]);
    return resultToTyped(result);
  }
}

function resultToTyped(result: { columns: string[]; values: unknown[][] }[]): CycleRecord[] {
  if (result.length === 0) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj as unknown as CycleRecord;
  });
}
