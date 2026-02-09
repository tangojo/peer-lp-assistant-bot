import { Bot } from 'grammy';
import { createChildLogger } from '../utils/logger.js';
import type { AlertMessage } from './console.js';

const log = createChildLogger('telegram');

let bot: Bot | null = null;
let chatId: string | null = null;

export function initTelegram(botToken: string, targetChatId: string): void {
  bot = new Bot(botToken);
  chatId = targetChatId;
  log.info('Telegram bot initialized');
}

const SEVERITY_EMOJI: Record<string, string> = {
  info: '\u2139\uFE0F',
  warn: '\u26A0\uFE0F',
  error: '\u274C',
};

export async function sendTelegramAlert(msg: AlertMessage): Promise<void> {
  if (!bot || !chatId) {
    log.debug('Telegram not configured, skipping alert');
    return;
  }

  const emoji = SEVERITY_EMOJI[msg.severity] ?? '';
  const text = `${emoji} *${escapeMarkdown(msg.title)}*\n${escapeMarkdown(msg.body)}`;

  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  } catch (err) {
    log.error({ err }, 'Failed to send Telegram message');
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}
