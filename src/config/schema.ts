import { z } from 'zod';

const walletSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address'),
});

const chainSchema = z.object({
  rpc_url: z.string().url().default('https://mainnet.base.org'),
  rpc_ws: z.string().optional(),
  chain_id: z.number().int().default(8453),
});

const peerSchema = z.object({
  escrow_address: z.string().default('0x2f121CDDCA6d652f35e8B3E560f9760898888888'),
  orchestrator_address: z.string().default('0x88888883Ed048FF0a415271B28b2F52d431810D0'),
  deposit_ids: z.array(z.number().int()).min(1),
  payment_method: z.string().default('revolut'),
  currency: z.string().default('EUR'),
});

const spreadSchema = z.object({
  mode: z.enum(['manual', 'auto']).default('manual'),
  target_margin_percent: z.number().min(0).default(1.0),
  recycling_cost_percent: z.number().min(0).default(0.4),
  gas_buffer_percent: z.number().min(0).default(0.1),
  min_spread_percent: z.number().min(0).default(0.5),
  max_spread_percent: z.number().min(0).default(3.0),
  auto_adjust_interval_minutes: z.number().int().min(5).default(30),
});

const revolutSchema = z.object({
  enabled: z.boolean().default(false),
  api_url: z.string().url().default('https://b2b.revolut.com/api/1.0'),
  webhook_port: z.number().int().default(3100),
});

const recyclingSchema = z.object({
  cex: z.enum(['kraken', 'coinbase']).default('kraken'),
  cex_fee_percent: z.number().min(0).default(0.26),
  bridge_gas_usd: z.number().min(0).default(0.05),
  low_balance_threshold_usdc: z.number().min(0).default(200),
  reminder_interval_hours: z.number().int().min(1).default(12),
});

const telegramAlertSchema = z.object({
  enabled: z.boolean().default(false),
  bot_token_env: z.string().default('TELEGRAM_BOT_TOKEN'),
  chat_id_env: z.string().default('TELEGRAM_CHAT_ID'),
});

const discordAlertSchema = z.object({
  enabled: z.boolean().default(false),
  webhook_url_env: z.string().default('DISCORD_WEBHOOK_URL'),
});

const consoleAlertSchema = z.object({
  enabled: z.boolean().default(true),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const alertsSchema = z.object({
  telegram: telegramAlertSchema.default({}),
  discord: discordAlertSchema.default({}),
  console: consoleAlertSchema.default({}),
});

const apiSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().default(3200),
  api_key_env: z.string().default('PEER_LP_API_KEY'),
});

const databaseSchema = z.object({
  path: z.string().default('./data/peer-lp.db'),
});

// Per-profile settings (wallet + peer + spread + revolut per user)
const profileSchema = z.object({
  name: z.string().min(1),
  wallet: walletSchema,
  peer: peerSchema,
  spread: spreadSchema.default({}),
  revolut: revolutSchema.default({}),
  recycling: recyclingSchema.default({}),
  private_key_env: z.string().default('PEER_LP_PRIVATE_KEY'),
});

export const configSchema = z.object({
  version: z.number().int().default(1),
  // Single-user (backward compatible)
  wallet: walletSchema.optional(),
  peer: peerSchema.optional(),
  spread: spreadSchema.default({}),
  revolut: revolutSchema.default({}),
  recycling: recyclingSchema.default({}),
  // Multi-user profiles
  profiles: z.array(profileSchema).optional(),
  // Shared settings
  chain: chainSchema.default({}),
  alerts: alertsSchema.default({}),
  api: apiSchema.default({}),
  database: databaseSchema.default({}),
}).refine(
  (cfg) => cfg.wallet != null || (cfg.profiles != null && cfg.profiles.length > 0),
  { message: 'Either top-level wallet+peer or profiles[] must be defined' },
);

export type RawConfig = z.infer<typeof configSchema>;
export type ProfileConfig = z.infer<typeof profileSchema>;

/** Resolved config: single profile merged with shared settings */
export interface AppConfig {
  version: number;
  wallet: { address: string };
  chain: z.infer<typeof chainSchema>;
  peer: z.infer<typeof peerSchema>;
  spread: z.infer<typeof spreadSchema>;
  revolut: z.infer<typeof revolutSchema>;
  recycling: z.infer<typeof recyclingSchema>;
  alerts: z.infer<typeof alertsSchema>;
  api: z.infer<typeof apiSchema>;
  database: z.infer<typeof databaseSchema>;
  profile_name: string;
  private_key_env: string;
}
