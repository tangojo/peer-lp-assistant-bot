import { insertForexSnapshot, getLatestForex } from '../db/queries.js';
import { createChildLogger } from '../utils/logger.js';
import { EventEmitter } from 'node:events';

const log = createChildLogger('forex-poller');

const ECB_URL = 'https://api.frankfurter.app/latest?from=EUR&to=USD';
const EXCHANGERATE_URL = 'https://open.er-api.com/v6/latest/EUR';

export type ForexEvents = {
  rateUpdated: [{ eurUsd: number; source: string }];
  error: [Error];
};

export class ForexPoller extends EventEmitter<ForexEvents> {
  private interval: ReturnType<typeof setInterval> | null = null;
  private currentRate: number | null = null;
  private pollIntervalMs: number;

  constructor(pollIntervalMs = 5 * 60 * 1000) {
    super();
    this.pollIntervalMs = pollIntervalMs;
  }

  async start(): Promise<void> {
    // Load last known rate from DB
    const last = getLatestForex();
    if (last) {
      this.currentRate = last.eur_usd;
      log.info({ rate: this.currentRate, source: last.source }, 'Loaded last known rate from DB');
    }

    // Fetch immediately on start
    await this.poll();

    // Then poll periodically
    this.interval = setInterval(() => this.poll(), this.pollIntervalMs);
    log.info({ intervalMs: this.pollIntervalMs }, 'Forex poller started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    log.info('Forex poller stopped');
  }

  getRate(): number | null {
    return this.currentRate;
  }

  private async poll(): Promise<void> {
    try {
      const result = await this.fetchECB();
      if (result) {
        this.updateRate(result.rate, 'ecb');
        return;
      }
    } catch (err) {
      log.warn({ err }, 'ECB API failed, trying fallback');
    }

    try {
      const result = await this.fetchExchangeRateAPI();
      if (result) {
        this.updateRate(result.rate, 'exchangerate-api');
        return;
      }
    } catch (err) {
      log.error({ err }, 'All forex sources failed');
      this.emit('error', err as Error);
    }
  }

  private updateRate(rate: number, source: string): void {
    const oldRate = this.currentRate;
    this.currentRate = rate;

    insertForexSnapshot(rate, source);
    this.emit('rateUpdated', { eurUsd: rate, source });

    if (oldRate && Math.abs(rate - oldRate) / oldRate > 0.005) {
      log.warn(
        { oldRate, newRate: rate, changePercent: (((rate - oldRate) / oldRate) * 100).toFixed(3) },
        'Significant EUR/USD rate change',
      );
    } else {
      log.debug({ rate, source }, 'EUR/USD rate updated');
    }
  }

  private async fetchECB(): Promise<{ rate: number } | null> {
    const res = await fetch(ECB_URL);
    if (!res.ok) return null;

    const data = (await res.json()) as { rates?: { USD?: number } };
    const rate = data.rates?.USD;
    if (!rate || typeof rate !== 'number') return null;

    return { rate };
  }

  private async fetchExchangeRateAPI(): Promise<{ rate: number } | null> {
    const res = await fetch(EXCHANGERATE_URL);
    if (!res.ok) return null;

    const data = (await res.json()) as { rates?: { USD?: number } };
    const rate = data.rates?.USD;
    if (!rate || typeof rate !== 'number') return null;

    return { rate };
  }
}
