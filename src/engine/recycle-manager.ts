import { getDb, saveDatabase } from '../db/connection.js';
import { createChildLogger } from '../utils/logger.js';
import type { AppConfig } from '../config/schema.js';
import { EventEmitter } from 'node:events';

const log = createChildLogger('recycle-manager');

export const RECYCLE_STATES = [
  'fiat_received',
  'sepa_sent',
  'cex_received',
  'usdc_bought',
  'bridged',
  'deposited',
] as const;

export type RecycleState = (typeof RECYCLE_STATES)[number];

export interface RecycleStep {
  cycleId: number;
  depositId: number;
  currentState: RecycleState;
  nextState: RecycleState | null;
  usdcSold: number;
  fiatReceived: number | null;
  startedAt: string;
}

export type RecycleEvents = {
  stateAdvanced: [{ cycleId: number; from: RecycleState; to: RecycleState }];
  recycleComplete: [{ cycleId: number; depositId: number }];
  reminderDue: [{ cycleId: number; state: RecycleState; hours: number }];
};

export class RecycleManager extends EventEmitter<RecycleEvents> {
  private config: AppConfig;
  private reminderInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: AppConfig) {
    super();
    this.config = config;
  }

  start(): void {
    // Check for stale cycles periodically
    const intervalMs = this.config.recycling.reminder_interval_hours * 60 * 60 * 1000;
    this.reminderInterval = setInterval(() => this.checkReminders(), intervalMs);
    log.info({ intervalHours: this.config.recycling.reminder_interval_hours }, 'Recycle manager started');
  }

  stop(): void {
    if (this.reminderInterval) {
      clearInterval(this.reminderInterval);
      this.reminderInterval = null;
    }
  }

  /** Get all open (non-closed) cycles with their recycle state */
  getOpenRecycles(): RecycleStep[] {
    const db = getDb();
    const result = db.exec(
      `SELECT id, deposit_id, usdc_sold, fiat_received, status, started_at
       FROM cycles WHERE status != 'closed' AND status != 'open'
       ORDER BY started_at ASC`,
    );

    if (result.length === 0) return [];

    const { columns, values } = result[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((c, i) => { obj[c] = row[i]; });

      const state = obj.status as RecycleState;
      return {
        cycleId: obj.id as number,
        depositId: obj.deposit_id as number,
        currentState: state,
        nextState: this.getNextState(state),
        usdcSold: obj.usdc_sold as number,
        fiatReceived: obj.fiat_received as number | null,
        startedAt: obj.started_at as string,
      };
    });
  }

  /** Advance a cycle to the next recycle state */
  advanceState(cycleId: number): { success: boolean; newState?: RecycleState; message: string } {
    const db = getDb();
    const result = db.exec('SELECT status FROM cycles WHERE id = ?', [cycleId]);

    if (result.length === 0 || result[0].values.length === 0) {
      return { success: false, message: `Cycle #${cycleId} not found` };
    }

    const currentState = result[0].values[0][0] as string;

    if (currentState === 'closed') {
      return { success: false, message: `Cycle #${cycleId} is already closed` };
    }

    if (currentState === 'open') {
      return { success: false, message: `Cycle #${cycleId} has no fiat received yet` };
    }

    const nextState = this.getNextState(currentState as RecycleState);

    if (!nextState) {
      return { success: false, message: `Cycle #${cycleId} has no next state from ${currentState}` };
    }

    // If advancing to 'deposited', close the cycle
    if (nextState === 'deposited') {
      db.run(
        `UPDATE cycles SET status = 'closed', completed_at = datetime('now'),
         recycling_cost_percent = ? WHERE id = ?`,
        [this.config.recycling.cex_fee_percent, cycleId],
      );
      saveDatabase();

      log.info({ cycleId, from: currentState, to: 'closed' }, 'Cycle completed');
      this.emit('recycleComplete', {
        cycleId,
        depositId: this.getCycleDepositId(cycleId),
      });

      return { success: true, newState: 'deposited' as RecycleState, message: `Cycle #${cycleId} completed and closed` };
    }

    db.run('UPDATE cycles SET status = ? WHERE id = ?', [nextState, cycleId]);
    saveDatabase();

    log.info({ cycleId, from: currentState, to: nextState }, 'Recycle state advanced');
    this.emit('stateAdvanced', {
      cycleId,
      from: currentState as RecycleState,
      to: nextState,
    });

    return { success: true, newState: nextState, message: `Cycle #${cycleId}: ${currentState} → ${nextState}` };
  }

  /** Mark a cycle as fiat_received (triggered by Revolut webhook or manual) */
  markFiatReceived(cycleId: number, fiatAmount: number, currency = 'EUR'): void {
    const db = getDb();
    db.run(
      `UPDATE cycles SET fiat_received = ?, fiat_currency = ?, status = 'fiat_received' WHERE id = ?`,
      [fiatAmount, currency, cycleId],
    );
    saveDatabase();
    log.info({ cycleId, fiatAmount, currency }, 'Fiat received, recycle started');
  }

  private getNextState(current: RecycleState): RecycleState | null {
    const idx = RECYCLE_STATES.indexOf(current);
    if (idx < 0 || idx >= RECYCLE_STATES.length - 1) return null;
    return RECYCLE_STATES[idx + 1];
  }

  private getCycleDepositId(cycleId: number): number {
    const db = getDb();
    const result = db.exec('SELECT deposit_id FROM cycles WHERE id = ?', [cycleId]);
    return (result[0]?.values[0]?.[0] as number) ?? 0;
  }

  private checkReminders(): void {
    const openRecycles = this.getOpenRecycles();
    const now = Date.now();

    for (const r of openRecycles) {
      const startedAt = new Date(r.startedAt).getTime();
      const hoursOpen = (now - startedAt) / (1000 * 60 * 60);

      // Remind if cycle has been in same state for more than reminder interval
      if (hoursOpen > this.config.recycling.reminder_interval_hours) {
        log.warn(
          { cycleId: r.cycleId, state: r.currentState, hours: Math.round(hoursOpen) },
          'Recycle cycle stale — action needed',
        );
        this.emit('reminderDue', {
          cycleId: r.cycleId,
          state: r.currentState,
          hours: Math.round(hoursOpen),
        });
      }
    }
  }
}
