import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Database } from 'sql.js';
import { setupTestDb, getTestDb, teardownTestDb } from '../test-helpers/db-setup.js';

// Mock the DB connection module to use our test DB
vi.mock('../db/connection.js', () => ({
  getDb: () => getTestDb(),
  saveDatabase: vi.fn(),
}));

import { RecycleManager, RECYCLE_STATES } from './recycle-manager.js';
import type { AppConfig } from '../config/schema.js';

function createTestConfig(): AppConfig {
  return {
    wallet: { address: '0x0000000000000000000000000000000000000000' },
    chain: { rpc_url: 'https://mainnet.base.org', chain_id: 8453 },
    peer: {
      escrow_address: '0x2f121CDDCA6d652f35e8B3E560f9760898888888',
      orchestrator_address: '0x88888883Ed048FF0a415271B28b2F52d431810D0',
      deposit_ids: [1],
      payment_method: 'revolut',
      currency: 'EUR',
    },
    spread: {
      mode: 'manual',
      target_margin_percent: 1.0,
      recycling_cost_percent: 0.4,
      gas_buffer_percent: 0.1,
      min_spread_percent: 0.5,
      max_spread_percent: 3.0,
      auto_adjust_interval_minutes: 30,
    },
    revolut: { enabled: false, api_url: 'https://b2b.revolut.com/api/1.0', webhook_port: 3100 },
    recycling: { cex: 'kraken', cex_fee_percent: 0.26, bridge_gas_usd: 0.05, low_balance_threshold_usdc: 200, reminder_interval_hours: 12 },
    alerts: {
      telegram: { enabled: false, bot_token_env: 'TELEGRAM_BOT_TOKEN', chat_id_env: 'TELEGRAM_CHAT_ID' },
      discord: { enabled: false, webhook_url_env: 'DISCORD_WEBHOOK_URL' },
      console: { enabled: false, log_level: 'info' },
    },
    api: { enabled: false, port: 3200, api_key_env: 'PEER_LP_API_KEY' },
    database: { path: ':memory:' },
    version: 1,
  } as AppConfig;
}

describe('RecycleManager', () => {
  let db: Database;
  let manager: RecycleManager;

  beforeEach(async () => {
    db = await setupTestDb();
    manager = new RecycleManager(createTestConfig());
  });

  afterEach(() => {
    manager.stop();
    teardownTestDb();
  });

  describe('RECYCLE_STATES', () => {
    it('has 6 states in correct order', () => {
      expect(RECYCLE_STATES).toEqual([
        'fiat_received',
        'sepa_sent',
        'cex_received',
        'usdc_bought',
        'bridged',
        'deposited',
      ]);
    });
  });

  describe('markFiatReceived', () => {
    it('updates cycle status to fiat_received', () => {
      // Insert an open cycle
      db.run(
        `INSERT INTO cycles (deposit_id, usdc_sold, status, started_at) VALUES (1, 100, 'open', datetime('now'))`,
      );
      const cycleId = (db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number);

      manager.markFiatReceived(cycleId, 92.50, 'EUR');

      const result = db.exec(`SELECT status, fiat_received, fiat_currency FROM cycles WHERE id = ?`, [cycleId]);
      expect(result[0].values[0][0]).toBe('fiat_received');
      expect(result[0].values[0][1]).toBe(92.50);
      expect(result[0].values[0][2]).toBe('EUR');
    });
  });

  describe('advanceState', () => {
    it('advances from fiat_received to sepa_sent', () => {
      db.run(
        `INSERT INTO cycles (deposit_id, usdc_sold, fiat_received, status, started_at) VALUES (1, 100, 92, 'fiat_received', datetime('now'))`,
      );
      const cycleId = (db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number);

      const result = manager.advanceState(cycleId);
      expect(result.success).toBe(true);
      expect(result.newState).toBe('sepa_sent');
    });

    it('advances through all states to completion', () => {
      db.run(
        `INSERT INTO cycles (deposit_id, usdc_sold, fiat_received, status, started_at) VALUES (1, 100, 92, 'fiat_received', datetime('now'))`,
      );
      const cycleId = (db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number);

      // fiat_received -> sepa_sent -> cex_received -> usdc_bought -> bridged -> deposited (closes)
      const expectedStates = ['sepa_sent', 'cex_received', 'usdc_bought', 'bridged', 'deposited'];

      for (const expected of expectedStates) {
        const result = manager.advanceState(cycleId);
        expect(result.success).toBe(true);
        expect(result.newState).toBe(expected);
      }

      // Verify cycle is closed
      const dbResult = db.exec('SELECT status FROM cycles WHERE id = ?', [cycleId]);
      expect(dbResult[0].values[0][0]).toBe('closed');
    });

    it('fails for non-existent cycle', () => {
      const result = manager.advanceState(999);
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('fails for already closed cycle', () => {
      db.run(
        `INSERT INTO cycles (deposit_id, usdc_sold, status, started_at) VALUES (1, 100, 'closed', datetime('now'))`,
      );
      const cycleId = (db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number);

      const result = manager.advanceState(cycleId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('already closed');
    });

    it('fails for open cycle with no fiat', () => {
      db.run(
        `INSERT INTO cycles (deposit_id, usdc_sold, status, started_at) VALUES (1, 100, 'open', datetime('now'))`,
      );
      const cycleId = (db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number);

      const result = manager.advanceState(cycleId);
      expect(result.success).toBe(false);
      expect(result.message).toContain('no fiat received');
    });

    it('emits stateAdvanced event', () => {
      db.run(
        `INSERT INTO cycles (deposit_id, usdc_sold, fiat_received, status, started_at) VALUES (1, 100, 92, 'fiat_received', datetime('now'))`,
      );
      const cycleId = (db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number);

      const handler = vi.fn();
      manager.on('stateAdvanced', handler);

      manager.advanceState(cycleId);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toEqual({
        cycleId,
        from: 'fiat_received',
        to: 'sepa_sent',
      });
    });

    it('emits recycleComplete event on final advance', () => {
      db.run(
        `INSERT INTO cycles (deposit_id, usdc_sold, fiat_received, status, started_at) VALUES (1, 100, 92, 'bridged', datetime('now'))`,
      );
      const cycleId = (db.exec('SELECT last_insert_rowid()')[0].values[0][0] as number);

      const handler = vi.fn();
      manager.on('recycleComplete', handler);

      manager.advanceState(cycleId);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].cycleId).toBe(cycleId);
    });
  });

  describe('getOpenRecycles', () => {
    it('returns empty array when no open recycles', () => {
      expect(manager.getOpenRecycles()).toEqual([]);
    });

    it('returns open recycles with correct shape', () => {
      db.run(
        `INSERT INTO cycles (deposit_id, usdc_sold, fiat_received, status, started_at) VALUES (1, 100, 92, 'sepa_sent', datetime('now'))`,
      );

      const recycles = manager.getOpenRecycles();
      expect(recycles).toHaveLength(1);
      expect(recycles[0].currentState).toBe('sepa_sent');
      expect(recycles[0].nextState).toBe('cex_received');
      expect(recycles[0].usdcSold).toBe(100);
    });

    it('excludes open (pre-fiat) and closed cycles', () => {
      db.run(`INSERT INTO cycles (deposit_id, usdc_sold, status, started_at) VALUES (1, 100, 'open', datetime('now'))`);
      db.run(`INSERT INTO cycles (deposit_id, usdc_sold, status, started_at) VALUES (1, 200, 'closed', datetime('now'))`);
      db.run(`INSERT INTO cycles (deposit_id, usdc_sold, fiat_received, status, started_at) VALUES (1, 300, 276, 'sepa_sent', datetime('now'))`);

      const recycles = manager.getOpenRecycles();
      expect(recycles).toHaveLength(1);
      expect(recycles[0].usdcSold).toBe(300);
    });
  });
});
