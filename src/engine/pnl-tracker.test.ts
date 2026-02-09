import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Database } from 'sql.js';
import { setupTestDb, getTestDb, teardownTestDb } from '../test-helpers/db-setup.js';

// Mock DB connection
vi.mock('../db/connection.js', () => ({
  getDb: () => getTestDb(),
  saveDatabase: vi.fn(),
}));

import { PnlTracker } from './pnl-tracker.js';
import { EventEmitter } from 'node:events';

function createMockForexPoller(rate: number | null = 1.18) {
  const poller = new EventEmitter() as EventEmitter & { getRate: () => number | null };
  poller.getRate = () => rate;
  return poller;
}

describe('PnlTracker', () => {
  let db: Database;
  let tracker: PnlTracker;

  beforeEach(async () => {
    db = await setupTestDb();
    tracker = new PnlTracker(createMockForexPoller(1.18) as never);
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('openCycle', () => {
    it('creates a new cycle with open status', () => {
      const cycleId = tracker.openCycle(1, 100, 1.5);
      expect(cycleId).toBeGreaterThan(0);

      const result = db.exec('SELECT * FROM cycles WHERE id = ?', [cycleId]);
      expect(result[0].values).toHaveLength(1);

      const cols = result[0].columns;
      const row = result[0].values[0];
      const cycle: Record<string, unknown> = {};
      cols.forEach((c, i) => { cycle[c] = row[i]; });

      expect(cycle.status).toBe('open');
      expect(cycle.deposit_id).toBe(1);
      expect(cycle.usdc_sold).toBe(100);
      expect(cycle.spread_earned_percent).toBe(1.5);
      expect(cycle.eur_usd_rate).toBe(1.18);
    });
  });

  describe('recordFiatReceived', () => {
    it('records fiat amount and updates status', () => {
      const cycleId = tracker.openCycle(1, 100, 1.5);
      tracker.recordFiatReceived(cycleId, 92.50, 'EUR');

      const result = db.exec('SELECT status, fiat_received, fiat_currency FROM cycles WHERE id = ?', [cycleId]);
      const row = result[0].values[0];
      expect(row[0]).toBe('fiat_received');
      expect(row[1]).toBe(92.50);
      expect(row[2]).toBe('EUR');
    });
  });

  describe('closeCycle', () => {
    it('calculates net profit correctly', () => {
      const cycleId = tracker.openCycle(1, 100, 1.5);
      tracker.recordFiatReceived(cycleId, 92.50, 'EUR');
      tracker.closeCycle(cycleId, 0.26);

      const result = db.exec('SELECT status, net_profit_fiat, net_profit_usd, recycling_cost_percent FROM cycles WHERE id = ?', [cycleId]);
      const cols = result[0].columns;
      const row = result[0].values[0];
      const cycle: Record<string, unknown> = {};
      cols.forEach((c, i) => { cycle[c] = row[i]; });

      expect(cycle.status).toBe('closed');
      expect(cycle.recycling_cost_percent).toBe(0.26);
      // net_profit_fiat = fiatReceived - usdcValueInFiat - recyclingCost
      // usdcValueInFiat = 100 / 1.18 = 84.745...
      // recyclingCost = 84.745 * 0.0026 = 0.220...
      // net_profit_fiat = 92.50 - 84.745 - 0.220 ≈ 7.534
      expect(cycle.net_profit_fiat).toBeCloseTo(7.534, 1);
      // net_profit_usd = 7.534 * 1.18 ≈ 8.89
      expect(cycle.net_profit_usd).toBeCloseTo(8.89, 0);
    });

    it('handles missing fiat (no profit calculation)', () => {
      const cycleId = tracker.openCycle(1, 100, 1.5);
      // Close without recording fiat
      tracker.closeCycle(cycleId, 0.26);

      const result = db.exec('SELECT net_profit_fiat, net_profit_usd FROM cycles WHERE id = ?', [cycleId]);
      const row = result[0].values[0];
      expect(row[0]).toBeNull();
      expect(row[1]).toBeNull();
    });

    it('does nothing for non-existent cycle', () => {
      // Should not throw
      tracker.closeCycle(999, 0.26);
    });
  });

  describe('getSummary', () => {
    it('returns zero summary when no cycles', () => {
      const summary = tracker.getSummary();
      expect(summary.totalCycles).toBe(0);
      expect(summary.completedCycles).toBe(0);
      expect(summary.totalUsdcSold).toBe(0);
      expect(summary.period).toBe('all-time');
    });

    it('returns correct summary for closed cycles', () => {
      // Create and close two cycles
      const c1 = tracker.openCycle(1, 100, 1.5);
      tracker.recordFiatReceived(c1, 92.50, 'EUR');
      tracker.closeCycle(c1, 0.26);

      const c2 = tracker.openCycle(1, 200, 1.5);
      tracker.recordFiatReceived(c2, 185.00, 'EUR');
      tracker.closeCycle(c2, 0.26);

      const summary = tracker.getSummary();
      expect(summary.totalCycles).toBe(2);
      expect(summary.completedCycles).toBe(2);
      expect(summary.totalUsdcSold).toBe(300);
    });

    it('accepts period filter', () => {
      const summary = tracker.getSummary(7);
      expect(summary.period).toBe('7d');
    });

    it('calculates annualized return', () => {
      const c1 = tracker.openCycle(1, 1000, 1.5);
      tracker.recordFiatReceived(c1, 925, 'EUR');
      tracker.closeCycle(c1, 0.26);

      const summary = tracker.getSummary(30);
      expect(summary.annualizedReturnPercent).not.toBeNull();
      // Should be positive since we profited
      if (summary.annualizedReturnPercent != null) {
        expect(summary.annualizedReturnPercent).toBeGreaterThan(0);
      }
    });
  });

  describe('getOpenCycles', () => {
    it('returns empty when no cycles', () => {
      expect(tracker.getOpenCycles()).toEqual([]);
    });

    it('returns open but not closed cycles', () => {
      tracker.openCycle(1, 100, 1.5);
      const c2 = tracker.openCycle(1, 200, 1.5);
      tracker.recordFiatReceived(c2, 185, 'EUR');
      tracker.closeCycle(c2, 0.26);

      const open = tracker.getOpenCycles();
      expect(open).toHaveLength(1);
      expect(open[0].usdc_sold).toBe(100);
    });
  });

  describe('getRecentCycles', () => {
    it('returns all cycles ordered by date', () => {
      tracker.openCycle(1, 100, 1.5);
      tracker.openCycle(1, 200, 1.5);
      tracker.openCycle(1, 300, 1.5);

      const recent = tracker.getRecentCycles(2);
      expect(recent).toHaveLength(2);
    });
  });
});
