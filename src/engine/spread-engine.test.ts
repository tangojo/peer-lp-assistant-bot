import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db queries before importing the module
vi.mock('../db/queries.js', () => ({
  insertSpreadChange: vi.fn(),
}));

import { SpreadEngine } from './spread-engine.js';
import type { AppConfig } from '../config/schema.js';
import { EventEmitter } from 'node:events';

// Create a minimal mock ForexPoller
function createMockForexPoller(rate: number | null = 1.18) {
  const poller = new EventEmitter() as EventEmitter & { getRate: () => number | null };
  poller.getRate = () => rate;
  return poller;
}

function createTestConfig(overrides: Partial<AppConfig['spread']> = {}): AppConfig {
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
      ...overrides,
    },
    revolut: { enabled: false, api_url: 'https://b2b.revolut.com/api/1.0', webhook_port: 3100 },
    recycling: { cex: 'kraken', cex_fee_percent: 0.26, bridge_gas_usd: 0.05, low_balance_threshold_usdc: 200, reminder_interval_hours: 12 },
    alerts: {
      telegram: { enabled: false, bot_token_env: 'TELEGRAM_BOT_TOKEN', chat_id_env: 'TELEGRAM_CHAT_ID' },
      discord: { enabled: false, webhook_url_env: 'DISCORD_WEBHOOK_URL' },
      console: { enabled: false, log_level: 'info' },
    },
    api: { enabled: false, port: 3200, api_key_env: 'PEER_LP_API_KEY' },
    database: { path: './data/test.db' },
    version: 1,
  } as AppConfig;
}

describe('SpreadEngine', () => {
  let engine: SpreadEngine;

  beforeEach(() => {
    const config = createTestConfig();
    const forex = createMockForexPoller(1.18);
    engine = new SpreadEngine(config, forex as never);
  });

  describe('spreadPercentToRate', () => {
    it('converts 0% spread to 1.0 rate', () => {
      const rate = engine.spreadPercentToRate(0);
      expect(rate).toBe(BigInt(1e18));
    });

    it('converts 1.5% spread correctly', () => {
      const rate = engine.spreadPercentToRate(1.5);
      // (1 - 0.015) * 10^18 = 0.985 * 10^18
      expect(rate).toBe(985000000000000000n);
    });

    it('converts 100% spread to 0 rate', () => {
      const rate = engine.spreadPercentToRate(100);
      expect(rate).toBe(0n);
    });

    it('converts small spread correctly', () => {
      const rate = engine.spreadPercentToRate(0.5);
      // (1 - 0.005) * 10^18 = 0.995 * 10^18
      expect(rate).toBe(995000000000000000n);
    });
  });

  describe('rateToSpreadPercent', () => {
    it('converts 1.0 rate to 0% spread', () => {
      const spread = engine.rateToSpreadPercent(BigInt(1e18));
      expect(spread).toBeCloseTo(0, 10);
    });

    it('converts 0.985 rate to 1.5% spread', () => {
      const spread = engine.rateToSpreadPercent(985000000000000000n);
      expect(spread).toBeCloseTo(1.5, 5);
    });

    it('round-trips correctly', () => {
      const original = 2.3;
      const rate = engine.spreadPercentToRate(original);
      const recovered = engine.rateToSpreadPercent(rate);
      expect(recovered).toBeCloseTo(original, 5);
    });
  });

  describe('getRecommendation', () => {
    it('calculates recommendation from config components', () => {
      const rec = engine.getRecommendation();
      // 0.4 + 1.0 + 0.1 = 1.5
      expect(rec.recommended).toBe(1.5);
      expect(rec.recyclingCost).toBe(0.4);
      expect(rec.targetMargin).toBe(1.0);
      expect(rec.gasBuffer).toBe(0.1);
    });

    it('includes EUR/USD rate from forex poller', () => {
      const rec = engine.getRecommendation();
      expect(rec.eurUsd).toBe(1.18);
    });

    it('includes breakdown string', () => {
      const rec = engine.getRecommendation();
      expect(rec.breakdown).toContain('0.4%');
      expect(rec.breakdown).toContain('1%');
      expect(rec.breakdown).toContain('0.1%');
      expect(rec.breakdown).toContain('1.50%');
    });

    it('returns null current when no spread set', () => {
      const rec = engine.getRecommendation();
      expect(rec.current).toBeNull();
    });
  });

  describe('isSpreadHealthy', () => {
    it('returns unhealthy when no current spread', () => {
      const health = engine.isSpreadHealthy();
      expect(health.healthy).toBe(false);
      expect(health.reason).toContain('No current spread');
    });

    it('returns healthy when spread is within range', () => {
      engine.setCurrentSpread(1, 1.5);
      const health = engine.isSpreadHealthy();
      expect(health.healthy).toBe(true);
    });

    it('returns unhealthy when below minimum', () => {
      engine.setCurrentSpread(1, 0.3);
      const health = engine.isSpreadHealthy();
      expect(health.healthy).toBe(false);
      expect(health.reason).toContain('below minimum');
    });

    it('returns unhealthy when above maximum', () => {
      engine.setCurrentSpread(1, 4.0);
      const health = engine.isSpreadHealthy();
      expect(health.healthy).toBe(false);
      expect(health.reason).toContain('above maximum');
    });

    it('returns unhealthy when deviation >30%', () => {
      // Recommendation is 1.5%, set current to 3.0% (100% deviation)
      engine.setCurrentSpread(1, 3.0);
      const health = engine.isSpreadHealthy();
      expect(health.healthy).toBe(false);
      expect(health.reason).toContain('deviates');
    });
  });

  describe('setCurrentSpread', () => {
    it('updates current spread in recommendation', () => {
      engine.setCurrentSpread(1, 2.0);
      expect(engine.getRecommendation().current).toBe(2.0);
    });
  });

  describe('events', () => {
    it('emits recommendationChanged on forex update', () => {
      const config = createTestConfig();
      const forex = createMockForexPoller(1.18);
      const eng = new SpreadEngine(config, forex as never);
      eng.start();

      const handler = vi.fn();
      eng.on('recommendationChanged', handler);

      // Simulate forex rate update
      forex.emit('rateUpdated');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].recommended).toBe(1.5);

      eng.stop();
    });

    it('does not emit when recommendation change is too small', () => {
      const config = createTestConfig();
      const forex = createMockForexPoller(1.18);
      const eng = new SpreadEngine(config, forex as never);
      eng.start();

      const handler = vi.fn();

      // First update triggers emission
      forex.emit('rateUpdated');

      eng.on('recommendationChanged', handler);

      // Same rate update — no change
      forex.emit('rateUpdated');

      expect(handler).not.toHaveBeenCalled();

      eng.stop();
    });
  });
});
