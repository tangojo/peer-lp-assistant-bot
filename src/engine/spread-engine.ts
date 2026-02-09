import type { AppConfig } from '../config/schema.js';
import type { ForexPoller } from '../forex/poller.js';
import { insertSpreadChange } from '../db/queries.js';
import { createChildLogger } from '../utils/logger.js';
import { EventEmitter } from 'node:events';

const log = createChildLogger('spread-engine');

export interface SpreadRecommendation {
  recommended: number;
  current: number | null;
  eurUsd: number | null;
  recyclingCost: number;
  targetMargin: number;
  gasBuffer: number;
  breakdown: string;
}

export type SpreadEvents = {
  recommendationChanged: [SpreadRecommendation];
};

export class SpreadEngine extends EventEmitter<SpreadEvents> {
  private config: AppConfig;
  private forexPoller: ForexPoller;
  private currentSpread: number | null = null;
  private lastRecommendation: number | null = null;

  constructor(config: AppConfig, forexPoller: ForexPoller) {
    super();
    this.config = config;
    this.forexPoller = forexPoller;
  }

  start(): void {
    // Recalculate on every forex rate update
    this.forexPoller.on('rateUpdated', () => {
      this.recalculate();
    });

    log.info({ mode: this.config.spread.mode }, 'Spread engine started');
  }

  /** Set the current on-chain spread (called from chain listener or manually) */
  setCurrentSpread(depositId: number, spread: number): void {
    const old = this.currentSpread;
    this.currentSpread = spread;

    if (old != null && old !== spread) {
      insertSpreadChange(depositId, old, spread, 'observed');
    }

    log.debug({ depositId, spread }, 'Current spread updated');
  }

  /** Get the current recommendation */
  getRecommendation(): SpreadRecommendation {
    const { target_margin_percent, recycling_cost_percent, gas_buffer_percent } = this.config.spread;
    const eurUsd = this.forexPoller.getRate();

    const recommended = recycling_cost_percent + target_margin_percent + gas_buffer_percent;

    return {
      recommended: Math.round(recommended * 100) / 100,
      current: this.currentSpread,
      eurUsd,
      recyclingCost: recycling_cost_percent,
      targetMargin: target_margin_percent,
      gasBuffer: gas_buffer_percent,
      breakdown: `${recycling_cost_percent}% recycling + ${target_margin_percent}% margin + ${gas_buffer_percent}% gas = ${recommended.toFixed(2)}%`,
    };
  }

  /** Check if current spread is within acceptable range */
  isSpreadHealthy(): { healthy: boolean; reason?: string } {
    if (this.currentSpread == null) {
      return { healthy: false, reason: 'No current spread data' };
    }

    const { min_spread_percent, max_spread_percent } = this.config.spread;
    const rec = this.getRecommendation();

    if (this.currentSpread < min_spread_percent) {
      return { healthy: false, reason: `Spread ${this.currentSpread}% below minimum ${min_spread_percent}%` };
    }
    if (this.currentSpread > max_spread_percent) {
      return { healthy: false, reason: `Spread ${this.currentSpread}% above maximum ${max_spread_percent}%` };
    }

    const deviation = Math.abs(this.currentSpread - rec.recommended) / rec.recommended;
    if (deviation > 0.3) {
      return { healthy: false, reason: `Spread ${this.currentSpread}% deviates >30% from recommendation ${rec.recommended}%` };
    }

    return { healthy: true };
  }

  private recalculate(): void {
    const rec = this.getRecommendation();

    if (this.lastRecommendation == null || Math.abs(rec.recommended - this.lastRecommendation) >= 0.05) {
      this.lastRecommendation = rec.recommended;
      log.info({ recommended: rec.recommended, breakdown: rec.breakdown }, 'Spread recommendation updated');
      this.emit('recommendationChanged', rec);
    }
  }
}
