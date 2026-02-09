import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { configSchema, type AppConfig, type RawConfig } from './schema.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('config');

const CONFIG_PATHS = [
  './config.yaml',
  './config.yml',
  './peer-lp.yaml',
  './peer-lp.yml',
];

export function loadConfig(configPath?: string, profileName?: string): AppConfig {
  const filePath = configPath ?? findConfigFile();

  if (!filePath) {
    throw new Error(
      `No config file found. Searched: ${CONFIG_PATHS.join(', ')}. ` +
      'Create a config.yaml or pass --config <path>.',
    );
  }

  log.info({ path: filePath }, 'Loading config');

  const raw = readFileSync(resolve(filePath), 'utf-8');
  const parsed = parseYaml(raw);

  const result = configSchema.safeParse(parsed);

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Config validation failed:\n${errors}`);
  }

  const resolved = resolveProfile(result.data, profileName);

  log.info(
    { profile: resolved.profile_name, wallet: resolved.wallet.address, deposits: resolved.peer.deposit_ids },
    'Config loaded',
  );

  return resolved;
}

/** Resolve a single AppConfig from raw config + optional profile name */
function resolveProfile(raw: RawConfig, profileName?: string): AppConfig {
  // Multi-user: profiles array defined
  if (raw.profiles && raw.profiles.length > 0) {
    const profile = profileName
      ? raw.profiles.find((p) => p.name === profileName)
      : raw.profiles[0]; // default to first profile

    if (!profile) {
      const available = raw.profiles.map((p) => p.name).join(', ');
      throw new Error(`Profile "${profileName}" not found. Available: ${available}`);
    }

    return {
      version: raw.version,
      wallet: profile.wallet,
      chain: raw.chain,
      peer: profile.peer,
      spread: profile.spread,
      revolut: profile.revolut,
      recycling: profile.recycling,
      alerts: raw.alerts,
      api: raw.api,
      database: raw.database,
      profile_name: profile.name,
      private_key_env: profile.private_key_env,
    };
  }

  // Single-user: top-level wallet + peer
  if (!raw.wallet || !raw.peer) {
    throw new Error('Either top-level wallet+peer or profiles[] must be defined');
  }

  return {
    version: raw.version,
    wallet: raw.wallet,
    chain: raw.chain,
    peer: raw.peer,
    spread: raw.spread,
    revolut: raw.revolut,
    recycling: raw.recycling,
    alerts: raw.alerts,
    api: raw.api,
    database: raw.database,
    profile_name: 'default',
    private_key_env: 'PEER_LP_PRIVATE_KEY',
  };
}

/** List available profile names from a config file */
export function listProfiles(configPath?: string): string[] {
  const filePath = configPath ?? findConfigFile();
  if (!filePath) return [];

  const raw = readFileSync(resolve(filePath), 'utf-8');
  const parsed = parseYaml(raw);
  const result = configSchema.safeParse(parsed);

  if (!result.success) return [];

  if (result.data.profiles) {
    return result.data.profiles.map((p) => p.name);
  }

  return ['default'];
}

function findConfigFile(): string | undefined {
  return CONFIG_PATHS.find((p) => existsSync(resolve(p)));
}
