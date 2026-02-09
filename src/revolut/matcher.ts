import { getDb, saveDatabase } from '../db/connection.js';
import { createChildLogger } from '../utils/logger.js';
import type { RevolutWebhookPayload } from './webhook.js';
import type { RecycleManager } from '../engine/recycle-manager.js';

const log = createChildLogger('revolut-matcher');

export class RevolutMatcher {
  private recycleManager: RecycleManager;

  constructor(recycleManager: RecycleManager) {
    this.recycleManager = recycleManager;
  }

  /** Process an incoming Revolut transaction and try to match it to a Peer order */
  matchTransaction(tx: RevolutWebhookPayload['data']): {
    matched: boolean;
    orderId?: number;
    cycleId?: number;
  } {
    const db = getDb();

    // Extract incoming leg (positive amount)
    const incomingLeg = tx.legs?.find((leg) => leg.amount > 0);
    if (!incomingLeg) {
      log.debug({ txId: tx.id }, 'No incoming leg found');
      return { matched: false };
    }

    const amount = incomingLeg.amount;
    const currency = incomingLeg.currency;
    const counterparty = incomingLeg.counterparty?.name ?? tx.reference ?? '';

    // Check for duplicate
    const existing = db.exec(
      'SELECT id FROM revolut_transactions WHERE revolut_tx_id = ?',
      [tx.id],
    );
    if (existing.length > 0 && existing[0].values.length > 0) {
      log.debug({ txId: tx.id }, 'Transaction already recorded');
      return { matched: false };
    }

    // Try to match to an open order:
    // Find fulfilled orders without a matched revolut transaction,
    // where fiat_amount is close to the received amount (within 5%)
    const unmatchedOrders = db.exec(
      `SELECT o.id, o.intent_hash, o.deposit_id, o.fiat_amount, o.usdc_amount
       FROM orders o
       LEFT JOIN revolut_transactions rt ON rt.matched_order_id = o.id
       WHERE o.status = 'fulfilled'
         AND rt.id IS NULL
       ORDER BY o.fulfilled_at DESC
       LIMIT 20`,
    );

    let matchedOrderId: number | null = null;

    if (unmatchedOrders.length > 0 && unmatchedOrders[0].values.length > 0) {
      const { columns, values } = unmatchedOrders[0];

      for (const row of values) {
        const order: Record<string, unknown> = {};
        columns.forEach((c, i) => { order[c] = row[i]; });

        // If fiat_amount is set, match within 5% tolerance
        if (order.fiat_amount != null) {
          const expected = order.fiat_amount as number;
          const tolerance = expected * 0.05;
          if (Math.abs(amount - expected) <= tolerance) {
            matchedOrderId = order.id as number;
            log.info(
              { txId: tx.id, orderId: matchedOrderId, expected, received: amount },
              'Matched Revolut TX to order by amount',
            );
            break;
          }
        }
      }

      // If no amount match, match to most recent unmatched fulfilled order
      if (matchedOrderId == null && values.length > 0) {
        const firstOrder: Record<string, unknown> = {};
        columns.forEach((c, i) => { firstOrder[c] = values[0][i]; });
        matchedOrderId = firstOrder.id as number;
        log.info(
          { txId: tx.id, orderId: matchedOrderId, amount },
          'Matched Revolut TX to most recent unmatched order (no amount match)',
        );
      }
    }

    // Insert revolut transaction
    db.run(
      `INSERT INTO revolut_transactions (revolut_tx_id, amount, currency, counterparty, reference, matched_order_id, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tx.id, amount, currency, counterparty, tx.reference ?? '', matchedOrderId, tx.completed_at ?? tx.created_at],
    );
    saveDatabase();

    // If matched, find the corresponding open cycle and mark fiat received
    if (matchedOrderId != null) {
      const cycleResult = db.exec(
        `SELECT c.id FROM cycles c
         JOIN orders o ON o.deposit_id = c.deposit_id
         WHERE o.id = ? AND c.status = 'open'
         ORDER BY c.started_at DESC LIMIT 1`,
        [matchedOrderId],
      );

      if (cycleResult.length > 0 && cycleResult[0].values.length > 0) {
        const cycleId = cycleResult[0].values[0][0] as number;
        this.recycleManager.markFiatReceived(cycleId, amount, currency);

        log.info({ txId: tx.id, orderId: matchedOrderId, cycleId, amount }, 'Cycle marked as fiat received');
        return { matched: true, orderId: matchedOrderId, cycleId };
      }

      return { matched: true, orderId: matchedOrderId };
    }

    log.info({ txId: tx.id, amount, currency, counterparty }, 'Revolut TX recorded (unmatched)');
    return { matched: false };
  }

  /** Get recent Revolut transactions from DB */
  getRecentTransactions(limit = 20): Record<string, unknown>[] {
    const db = getDb();
    const result = db.exec(
      'SELECT * FROM revolut_transactions ORDER BY received_at DESC LIMIT ?',
      [limit],
    );
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((c, i) => { obj[c] = row[i]; });
      return obj;
    });
  }
}
