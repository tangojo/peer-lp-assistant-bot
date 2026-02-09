import { createChildLogger } from '../utils/logger.js';
import type { AlertMessage } from './console.js';

const log = createChildLogger('discord');

let webhookUrl: string | null = null;

export function initDiscord(url: string): void {
  webhookUrl = url;
  log.info('Discord webhook initialized');
}

const SEVERITY_EMOJI: Record<string, string> = {
  info: '\u2139\uFE0F',
  warn: '\u26A0\uFE0F',
  error: '\u274C',
};

export async function sendDiscordAlert(msg: AlertMessage): Promise<void> {
  if (!webhookUrl) {
    log.debug('Discord not configured, skipping alert');
    return;
  }

  const emoji = SEVERITY_EMOJI[msg.severity] ?? '';
  const content = `${emoji} **${msg.title}**\n${msg.body}`;

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      log.error({ status: res.status }, 'Discord webhook failed');
    }
  } catch (err) {
    log.error({ err }, 'Failed to send Discord message');
  }
}
