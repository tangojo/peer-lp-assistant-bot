import type { ChainListener, IntentSignaledEvent, FundsLockedEvent, FundsReleasedEvent, IntentFulfilledEvent } from '../chain/listener.js';
import { insertOrder, updateOrderStatus, getOrders, getOrderStats, getOrderByHash } from '../db/queries.js';
import { createChildLogger } from '../utils/logger.js';
import { EventEmitter } from 'node:events';

const log = createChildLogger('order-manager');

// USDC has 6 decimals
const USDC_DECIMALS = 6n;

export type OrderStatus = 'signaled' | 'locked' | 'fulfilled' | 'expired' | 'cancelled';

export type OrderEvents = {
  newOrder: [{ intentHash: string; depositId: number; usdcAmount: number; buyerAddress: string }];
  orderLocked: [{ intentHash: string; depositId: number }];
  orderFulfilled: [{ intentHash: string; depositId: number; usdcAmount: number; fillTimeSeconds: number | null }];
  orderExpired: [{ intentHash: string; depositId: number }];
};

export class OrderManager extends EventEmitter<OrderEvents> {
  constructor(private chainListener: ChainListener) {
    super();
  }

  start(): void {
    this.chainListener.on('intentSignaled', (event) => this.onIntentSignaled(event));
    this.chainListener.on('fundsLocked', (event) => this.onFundsLocked(event));
    this.chainListener.on('fundsReleased', (event) => this.onFundsReleased(event));
    this.chainListener.on('intentFulfilled', (event) => this.onIntentFulfilled(event));

    log.info('Order manager started');
  }

  private onIntentSignaled(event: IntentSignaledEvent): void {
    const usdcAmount = Number(event.amount) / Number(10n ** USDC_DECIMALS);

    insertOrder({
      intent_hash: event.intentHash,
      deposit_id: event.depositId,
      buyer_address: event.owner,
      usdc_amount: usdcAmount,
      conversion_rate: Number(event.conversionRate),
      status: 'signaled',
      signaled_at: new Date(Number(event.timestamp) * 1000).toISOString(),
      tx_hash: event.txHash,
    });

    log.info(
      { intentHash: event.intentHash, depositId: event.depositId, usdc: usdcAmount },
      'New order tracked',
    );

    this.emit('newOrder', {
      intentHash: event.intentHash,
      depositId: event.depositId,
      usdcAmount,
      buyerAddress: event.owner,
    });
  }

  private onFundsLocked(event: FundsLockedEvent): void {
    updateOrderStatus(event.intentHash, 'locked', {
      locked_at: new Date().toISOString(),
    });

    log.info({ intentHash: event.intentHash }, 'Order locked');

    this.emit('orderLocked', {
      intentHash: event.intentHash,
      depositId: event.depositId,
    });
  }

  private onFundsReleased(event: FundsReleasedEvent): void {
    const existing = getOrderByHash(event.intentHash);
    let fillTimeSeconds: number | null = null;

    if (existing?.signaled_at) {
      const signaledAt = new Date(existing.signaled_at as string).getTime();
      const now = Date.now();
      fillTimeSeconds = Math.round((now - signaledAt) / 1000);
    }

    const usdcAmount = Number(event.transferredAmount) / Number(10n ** USDC_DECIMALS);

    updateOrderStatus(event.intentHash, 'fulfilled', {
      fulfilled_at: new Date().toISOString(),
      fill_time_seconds: fillTimeSeconds ?? undefined,
      tx_hash: event.txHash,
    });

    log.info(
      { intentHash: event.intentHash, fillTimeSeconds, usdc: usdcAmount },
      'Order fulfilled',
    );

    this.emit('orderFulfilled', {
      intentHash: event.intentHash,
      depositId: event.depositId,
      usdcAmount,
      fillTimeSeconds,
    });
  }

  private onIntentFulfilled(_event: IntentFulfilledEvent): void {
    // IntentFulfilled from Orchestrator confirms the fill.
    // The actual state update happens in onFundsReleased from Escrow.
    // This event is useful for cross-referencing.
    log.debug({ intentHash: _event.intentHash }, 'IntentFulfilled confirmation received');
  }

  getRecentOrders(limit = 20) {
    return getOrders(limit);
  }

  getStats() {
    return getOrderStats();
  }
}
