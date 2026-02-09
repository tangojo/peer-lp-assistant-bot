import { describe, it, expect } from 'vitest';
import { configSchema } from './schema.js';

describe('configSchema', () => {
  const minimalConfig = {
    wallet: { address: '0x1234567890abcdef1234567890abcdef12345678' },
    peer: { deposit_ids: [1] },
  };

  it('accepts minimal valid config', () => {
    const result = configSchema.safeParse(minimalConfig);
    expect(result.success).toBe(true);
  });

  it('provides defaults for chain settings', () => {
    const result = configSchema.parse(minimalConfig);
    expect(result.chain.rpc_url).toBe('https://mainnet.base.org');
    expect(result.chain.chain_id).toBe(8453);
  });

  it('provides defaults for spread settings', () => {
    const result = configSchema.parse(minimalConfig);
    expect(result.spread.mode).toBe('manual');
    expect(result.spread.target_margin_percent).toBe(1.0);
    expect(result.spread.recycling_cost_percent).toBe(0.4);
    expect(result.spread.gas_buffer_percent).toBe(0.1);
    expect(result.spread.min_spread_percent).toBe(0.5);
    expect(result.spread.max_spread_percent).toBe(3.0);
  });

  it('provides defaults for alerts', () => {
    const result = configSchema.parse(minimalConfig);
    expect(result.alerts.telegram.enabled).toBe(false);
    expect(result.alerts.discord.enabled).toBe(false);
    expect(result.alerts.console.enabled).toBe(true);
  });

  it('rejects invalid wallet address', () => {
    const invalid = { ...minimalConfig, wallet: { address: 'not-an-address' } };
    const result = configSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects empty deposit_ids', () => {
    const invalid = { ...minimalConfig, peer: { deposit_ids: [] } };
    const result = configSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts full config with overrides', () => {
    const full = {
      ...minimalConfig,
      spread: {
        mode: 'auto' as const,
        target_margin_percent: 2.0,
        recycling_cost_percent: 0.5,
        gas_buffer_percent: 0.2,
        min_spread_percent: 1.0,
        max_spread_percent: 5.0,
        auto_adjust_interval_minutes: 15,
      },
      revolut: { enabled: true, webhook_port: 4000 },
      api: { enabled: true, port: 8080 },
    };
    const result = configSchema.safeParse(full);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.spread.mode).toBe('auto');
      expect(result.data.revolut.webhook_port).toBe(4000);
      expect(result.data.api.port).toBe(8080);
    }
  });

  it('rejects auto_adjust_interval below 5 minutes', () => {
    const invalid = {
      ...minimalConfig,
      spread: { auto_adjust_interval_minutes: 2 },
    };
    const result = configSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('provides defaults for recycling', () => {
    const result = configSchema.parse(minimalConfig);
    expect(result.recycling.cex).toBe('kraken');
    expect(result.recycling.cex_fee_percent).toBe(0.26);
    expect(result.recycling.reminder_interval_hours).toBe(12);
  });

  it('provides defaults for database path', () => {
    const result = configSchema.parse(minimalConfig);
    expect(result.database.path).toBe('./data/peer-lp.db');
  });

  it('accepts multi-user profiles config', () => {
    const multiUser = {
      profiles: [
        {
          name: 'main',
          wallet: { address: '0x1234567890abcdef1234567890abcdef12345678' },
          peer: { deposit_ids: [1, 2] },
        },
        {
          name: 'secondary',
          wallet: { address: '0xabcdef1234567890abcdef1234567890abcdef12' },
          peer: { deposit_ids: [3] },
          private_key_env: 'SECONDARY_PRIVATE_KEY',
        },
      ],
    };
    const result = configSchema.safeParse(multiUser);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.profiles).toHaveLength(2);
      expect(result.data.profiles![0].name).toBe('main');
      expect(result.data.profiles![1].private_key_env).toBe('SECONDARY_PRIVATE_KEY');
    }
  });

  it('rejects config with neither wallet nor profiles', () => {
    const invalid = { chain: { chain_id: 8453 } };
    const result = configSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
