import type { AppConfig } from '../config/schema.js';
import type { OrderManager } from '../engine/order-manager.js';
import type { SpreadEngine, SpreadRecommendation } from '../engine/spread-engine.js';
import type { RecycleManager } from '../engine/recycle-manager.js';
import type { RevolutClient } from '../revolut/client.js';
import { sendConsoleAlert, type AlertMessage } from './console.js';
import { initTelegram, sendTelegramAlert } from './telegram.js';
import { initDiscord, sendDiscordAlert } from './discord.js';
import { formatUSD, formatPercent, shortenAddress, shortenHash, formatDuration } from '../utils/formatting.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('alert-service');

let config: AppConfig;

export function initAlertService(cfg: AppConfig): void {
  config = cfg;

  // Initialize Telegram if configured
  if (cfg.alerts.telegram.enabled) {
    const token = process.env[cfg.alerts.telegram.bot_token_env];
    const chat = process.env[cfg.alerts.telegram.chat_id_env];

    if (token && chat) {
      initTelegram(token, chat);
    } else {
      log.warn('Telegram enabled but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set');
    }
  }

  // Initialize Discord if configured
  if (cfg.alerts.discord.enabled) {
    const url = process.env[cfg.alerts.discord.webhook_url_env];
    if (url) {
      initDiscord(url);
    } else {
      log.warn('Discord enabled but DISCORD_WEBHOOK_URL not set');
    }
  }
}

export function connectOrderManager(orderManager: OrderManager): void {
  orderManager.on('newOrder', (event) => {
    sendAlert({
      severity: 'info',
      title: 'New Order',
      body: `Deposit #${event.depositId} | ${formatUSD(event.usdcAmount)} USDC\nBuyer: ${shortenAddress(event.buyerAddress)}\nIntent: ${shortenHash(event.intentHash)}`,
    });
  });

  orderManager.on('orderLocked', (event) => {
    sendAlert({
      severity: 'info',
      title: 'Funds Locked',
      body: `Deposit #${event.depositId}\nIntent: ${shortenHash(event.intentHash)}`,
    });
  });

  orderManager.on('orderFulfilled', (event) => {
    const fillInfo = event.fillTimeSeconds != null
      ? `\nFill time: ${formatDuration(event.fillTimeSeconds)}`
      : '';

    sendAlert({
      severity: 'info',
      title: 'Order Fulfilled',
      body: `Deposit #${event.depositId} | ${formatUSD(event.usdcAmount)} USDC${fillInfo}\nIntent: ${shortenHash(event.intentHash)}`,
    });
  });

  orderManager.on('orderExpired', (event) => {
    sendAlert({
      severity: 'warn',
      title: 'Order Expired',
      body: `Deposit #${event.depositId}\nIntent: ${shortenHash(event.intentHash)}`,
    });
  });

  log.info('Alert service connected to order manager');
}

export function connectSpreadEngine(spreadEngine: SpreadEngine): void {
  spreadEngine.on('recommendationChanged', (rec: SpreadRecommendation) => {
    sendAlert({
      severity: 'info',
      title: 'Spread Recommendation Changed',
      body: `Recommended: ${formatPercent(rec.recommended)}\n${rec.breakdown}`,
    });
  });

  log.info('Alert service connected to spread engine');
}

export function connectRecycleManager(recycleManager: RecycleManager): void {
  recycleManager.on('stateAdvanced', (event) => {
    sendAlert({
      severity: 'info',
      title: 'Recycle Loop Advanced',
      body: `Cycle #${event.cycleId}: ${event.from} → ${event.to}`,
    });
  });

  recycleManager.on('recycleComplete', (event) => {
    sendAlert({
      severity: 'info',
      title: 'Recycle Complete',
      body: `Cycle #${event.cycleId} (Deposit #${event.depositId}) is fully recycled`,
    });
  });

  recycleManager.on('reminderDue', (event) => {
    sendAlert({
      severity: 'warn',
      title: 'Recycle Reminder',
      body: `Cycle #${event.cycleId} stuck at "${event.state}" for ${event.hours}h — action needed`,
    });
  });

  log.info('Alert service connected to recycle manager');
}

export function connectRevolutClient(revolutClient: RevolutClient): void {
  // Check token health on startup
  const health = revolutClient.checkTokenHealth();
  if (!health.healthy) {
    sendAlert({
      severity: 'error',
      title: 'Revolut Token Warning',
      body: health.message ?? 'Token may be expiring soon',
    });
  } else if (health.daysUntilExpiry != null && health.daysUntilExpiry <= 14) {
    sendAlert({
      severity: 'warn',
      title: 'Revolut Token Reminder',
      body: `Token expires in ~${health.daysUntilExpiry} days — plan refresh`,
    });
  }

  log.info('Alert service connected to Revolut client');
}

export async function sendAlert(msg: AlertMessage): Promise<void> {
  // Always log to console
  if (config.alerts.console.enabled) {
    sendConsoleAlert(msg);
  }

  // Send to Telegram
  if (config.alerts.telegram.enabled) {
    await sendTelegramAlert(msg);
  }

  // Send to Discord
  if (config.alerts.discord.enabled) {
    await sendDiscordAlert(msg);
  }
}
