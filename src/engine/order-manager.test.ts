import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setupTestDb, getTestDb, teardownTestDb } from '../test-helpers/db-setup.js';

// Mock DB connection
vi.mock('../db/connection.js', () => ({
  getDb: () => getTestDb(),
  saveDatabase: vi.fn(),
}));

import { OrderManager } from './order-manager.js';
import { EventEmitter } from 'node:events';
import type { ChainEvents, IntentSignaledEvent, FundsLockedEvent, FundsReleasedEvent } from '../chain/listener.js';

function createMockChainListener() {
  return new EventEmitter<ChainEvents>();
}

describe('OrderManager', () => {
  let chainListener: EventEmitter<ChainEvents>;
  let orderManager: OrderManager;

  beforeEach(async () => {
    await setupTestDb();
    chainListener = createMockChainListener();
    orderManager = new OrderManager(chainListener as never);
    orderManager.start();
  });

  afterEach(() => {
    teardownTestDb();
  });

  describe('event handling', () => {
    it('emits newOrder on intentSignaled', () => {
      const handler = vi.fn();
      orderManager.on('newOrder', handler);

      const event: IntentSignaledEvent = {
        intentHash: '0xabc123',
        escrow: '0x1234',
        depositId: 1,
        paymentMethod: 'revolut',
        owner: '0xbuyer',
        to: '0xseller',
        amount: 100_000000n, // 100 USDC (6 decimals)
        fiatCurrency: 'EUR',
        conversionRate: 985000000000000000n,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
        txHash: '0xtx1',
      };

      chainListener.emit('intentSignaled', event);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toMatchObject({
        intentHash: '0xabc123',
        depositId: 1,
        usdcAmount: 100,
        buyerAddress: '0xbuyer',
      });
    });

    it('stores order in database', () => {
      const event: IntentSignaledEvent = {
        intentHash: '0xdef456',
        escrow: '0x1234',
        depositId: 1,
        paymentMethod: 'revolut',
        owner: '0xbuyer2',
        to: '0xseller',
        amount: 50_000000n, // 50 USDC
        fiatCurrency: 'EUR',
        conversionRate: 985000000000000000n,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
        txHash: '0xtx2',
      };

      chainListener.emit('intentSignaled', event);

      const db = getTestDb();
      const result = db.exec('SELECT * FROM orders WHERE intent_hash = ?', ['0xdef456']);
      expect(result[0].values).toHaveLength(1);

      const cols = result[0].columns;
      const row = result[0].values[0];
      const order: Record<string, unknown> = {};
      cols.forEach((c, i) => { order[c] = row[i]; });

      expect(order.status).toBe('signaled');
      expect(order.usdc_amount).toBe(50);
      expect(order.deposit_id).toBe(1);
    });

    it('emits orderLocked on fundsLocked', () => {
      // First signal an order
      chainListener.emit('intentSignaled', {
        intentHash: '0xlock1',
        escrow: '0x1234',
        depositId: 1,
        paymentMethod: 'revolut',
        owner: '0xbuyer',
        to: '0xseller',
        amount: 100_000000n,
        fiatCurrency: 'EUR',
        conversionRate: 985000000000000000n,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
        txHash: '0xtx3',
      } satisfies IntentSignaledEvent);

      const handler = vi.fn();
      orderManager.on('orderLocked', handler);

      chainListener.emit('fundsLocked', {
        depositId: 1,
        intentHash: '0xlock1',
        amount: 100_000000n,
        expiryTime: BigInt(Math.floor(Date.now() / 1000) + 3600),
        txHash: '0xtx4',
      } satisfies FundsLockedEvent);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].intentHash).toBe('0xlock1');
    });

    it('emits orderFulfilled on fundsReleased', () => {
      // Signal → Lock → Release
      const now = Math.floor(Date.now() / 1000);
      chainListener.emit('intentSignaled', {
        intentHash: '0xfill1',
        escrow: '0x1234',
        depositId: 1,
        paymentMethod: 'revolut',
        owner: '0xbuyer',
        to: '0xseller',
        amount: 200_000000n,
        fiatCurrency: 'EUR',
        conversionRate: 985000000000000000n,
        timestamp: BigInt(now),
        txHash: '0xtx5',
      } satisfies IntentSignaledEvent);

      const handler = vi.fn();
      orderManager.on('orderFulfilled', handler);

      chainListener.emit('fundsReleased', {
        depositId: 1,
        intentHash: '0xfill1',
        unlockedAmount: 200_000000n,
        transferredAmount: 200_000000n,
        to: '0xbuyer',
        txHash: '0xtx6',
      } satisfies FundsReleasedEvent);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].usdcAmount).toBe(200);
    });
  });

  describe('getRecentOrders', () => {
    it('returns empty array when no orders', () => {
      const orders = orderManager.getRecentOrders();
      expect(orders).toEqual([]);
    });

    it('returns orders after events', () => {
      chainListener.emit('intentSignaled', {
        intentHash: '0xrecent1',
        escrow: '0x1234',
        depositId: 1,
        paymentMethod: 'revolut',
        owner: '0xbuyer',
        to: '0xseller',
        amount: 75_000000n,
        fiatCurrency: 'EUR',
        conversionRate: 985000000000000000n,
        timestamp: BigInt(Math.floor(Date.now() / 1000)),
        txHash: '0xtx7',
      } satisfies IntentSignaledEvent);

      const orders = orderManager.getRecentOrders();
      expect(orders).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('returns zero stats when empty', () => {
      const stats = orderManager.getStats();
      expect(stats.total).toBe(0);
      expect(stats.fulfilled).toBe(0);
      expect(stats.avgFillTime).toBeNull();
    });
  });
});
