import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { configSchema, type AppConfig } from './schema.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('config');

const CONFIG_PATHS = [
  './config.yaml',
  './config.yml',
  './peer-lp.yaml',
  './peer-lp.yml',
];

export function loadConfig(configPath?: string): AppConfig {
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

  log.info(
    { wallet: result.data.wallet.address, deposits: result.data.peer.deposit_ids },
    'Config loaded',
  );

  return result.data;
}

function findConfigFile(): string | undefined {
  return CONFIG_PATHS.find((p) => existsSync(resolve(p)));
}
