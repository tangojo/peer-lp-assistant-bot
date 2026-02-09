import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig } from './loader.js';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('loadConfig', () => {
  const testDir = join(tmpdir(), 'peer-lp-test-config');

  beforeEach(() => {
    try { rmSync(testDir, { recursive: true }); } catch {}
    mkdirSync(testDir, { recursive: true });
  });

  it('loads valid YAML config', () => {
    const configPath = join(testDir, 'config.yaml');
    writeFileSync(configPath, `
wallet:
  address: "0x1234567890abcdef1234567890abcdef12345678"
peer:
  deposit_ids: [1, 2]
`);

    const config = loadConfig(configPath);
    expect(config.wallet.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(config.peer.deposit_ids).toEqual([1, 2]);
    expect(config.chain.rpc_url).toBe('https://mainnet.base.org');
  });

  it('throws on invalid config', () => {
    const configPath = join(testDir, 'bad.yaml');
    writeFileSync(configPath, `
wallet:
  address: "not-valid"
peer:
  deposit_ids: []
`);

    expect(() => loadConfig(configPath)).toThrow('Config validation failed');
  });

  it('throws when no config file found', () => {
    // Use a non-existent path and ensure no default config exists
    expect(() => loadConfig(join(testDir, 'nonexistent.yaml'))).toThrow();
  });
});
