import type { AppConfig } from '../config/schema.js';
import type { ForexPoller } from '../forex/poller.js';
import type { EscrowManager } from '../chain/escrow-manager.js';
import type { CompetitionAnalyzer } from './competition.js';
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
  autoAdjusted: [{ depositId: number; oldRate: bigint; newRate: bigint; txHash: string }];
  autoAdjustFailed: [{ depositId: number; error: string }];
};

export class SpreadEngine extends EventEmitter<SpreadEvents> {
  private config: AppConfig;
  private forexPoller: ForexPoller;
  private escrowManager: EscrowManager | null = null;
  private competitionAnalyzer: CompetitionAnalyzer | null = null;
  private currentSpread: number | null = null;
  private lastRecommendation: number | null = null;
  private autoInterval: ReturnType<typeof setInterval> | null = null;
  private lastAutoAdjust = 0;

  constructor(config: AppConfig, forexPoller: ForexPoller) {
    super();
    this.config = config;
    this.forexPoller = forexPoller;
  }

  /** Connect escrow manager for auto-mode on-chain writes */
  setEscrowManager(em: EscrowManager): void {
    this.escrowManager = em;
  }

  /** Connect competition analyzer for market-aware recommendations */
  setCompetitionAnalyzer(ca: CompetitionAnalyzer): void {
    this.competitionAnalyzer = ca;
  }

  start(): void {
    // Recalculate on every forex rate update
    this.forexPoller.on('rateUpdated', () => {
      this.recalculate();
    });

    // Auto-mode: periodically check and adjust on-chain
    if (this.config.spread.mode === 'auto') {
      const intervalMs = this.config.spread.auto_adjust_interval_minutes * 60 * 1000;
      this.autoInterval = setInterval(() => this.autoAdjust(), intervalMs);
      log.info({ intervalMin: this.config.spread.auto_adjust_interval_minutes }, 'Auto-spread enabled');
    }

    log.info({ mode: this.config.spread.mode }, 'Spread engine started');
  }

  stop(): void {
    if (this.autoInterval) {
      clearInterval(this.autoInterval);
      this.autoInterval = null;
    }
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

  /** Convert a spread percentage to on-chain conversion rate */
  spreadPercentToRate(spreadPercent: number): bigint {
    // minConversionRate = (1 - spread/100) * 10^18
    // e.g. 1.5% spread → rate = 0.985 * 10^18 = 985000000000000000
    const factor = 1 - spreadPercent / 100;
    return BigInt(Math.round(factor * 1e18));
  }

  /** Convert on-chain rate to spread percentage */
  rateToSpreadPercent(rate: bigint): number {
    // spread = (1 - rate/10^18) * 100
    const factor = Number(rate) / 1e18;
    return (1 - factor) * 100;
  }

  private recalculate(): void {
    const rec = this.getRecommendation();

    if (this.lastRecommendation == null || Math.abs(rec.recommended - this.lastRecommendation) >= 0.05) {
      this.lastRecommendation = rec.recommended;
      log.info({ recommended: rec.recommended, breakdown: rec.breakdown }, 'Spread recommendation updated');
      this.emit('recommendationChanged', rec);
    }
  }

  private async autoAdjust(): Promise<void> {
    if (!this.escrowManager) {
      log.warn('Auto-adjust skipped — no escrow manager connected');
      return;
    }

    // Rate-limit: minimum 5 minutes between adjustments
    if (Date.now() - this.lastAutoAdjust < 5 * 60 * 1000) return;

    // Log competition context if analyzer is available
    if (this.competitionAnalyzer) {
      try {
        const snapshot = await this.competitionAnalyzer.analyze();
        log.info(
          { competitors: snapshot.competitors.length, totalLiquidity: snapshot.totalLiquidity },
          'Competition snapshot for auto-adjust',
        );
      } catch (err) {
        log.warn({ err }, 'Competition analysis failed, continuing with base recommendation');
      }
    }

    const rec = this.getRecommendation();
    const { min_spread_percent, max_spread_percent } = this.config.spread;

    // Clamp to configured bounds
    const targetSpread = Math.max(min_spread_percent, Math.min(max_spread_percent, rec.recommended));
    const newRate = this.spreadPercentToRate(targetSpread);

    for (const depositId of this.config.peer.deposit_ids) {
      try {
        const currentRate = await this.escrowManager.getCurrentRate(
          depositId,
          this.config.peer.payment_method,
          this.config.peer.currency,
        );

        // Only adjust if difference is significant (>0.1%)
        const currentSpread = this.rateToSpreadPercent(currentRate);
        if (Math.abs(currentSpread - targetSpread) < 0.1) {
          log.debug({ depositId, currentSpread, targetSpread }, 'Spread difference too small, skipping');
          continue;
        }

        const txHash = await this.escrowManager.setCurrencyMinRate(depositId, newRate);
        this.lastAutoAdjust = Date.now();

        insertSpreadChange(depositId, currentSpread, targetSpread, `auto:forex`);
        this.setCurrentSpread(depositId, targetSpread);

        log.info({ depositId, from: currentSpread, to: targetSpread, txHash }, 'Auto-spread adjusted');
        this.emit('autoAdjusted', { depositId, oldRate: currentRate, newRate, txHash });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ depositId, err }, 'Auto-adjust failed');
        this.emit('autoAdjustFailed', { depositId, error: msg });
      }
    }
  }
}
