import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/schema.js';
import type { OrderManager } from '../engine/order-manager.js';
import type { PnlTracker } from '../engine/pnl-tracker.js';
import type { SpreadEngine } from '../engine/spread-engine.js';
import type { ForexPoller } from '../forex/poller.js';
import { getDeposits } from '../db/queries.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('api');

export interface ApiDependencies {
  config: AppConfig;
  orderManager: OrderManager;
  pnlTracker: PnlTracker;
  spreadEngine: SpreadEngine;
  forexPoller: ForexPoller;
}

export async function startApiServer(deps: ApiDependencies): Promise<void> {
  const { config, orderManager, pnlTracker, spreadEngine, forexPoller } = deps;

  const server = Fastify({ logger: false });
  const apiKey = process.env[config.api.api_key_env];

  // Bearer auth middleware
  if (apiKey) {
    const expectedAuth = Buffer.from(`Bearer ${apiKey}`);
    server.addHook('onRequest', async (request, reply) => {
      const auth = request.headers.authorization;
      if (!auth) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }
      const authBuf = Buffer.from(auth);
      if (authBuf.length !== expectedAuth.length || !timingSafeEqual(authBuf, expectedAuth)) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
    log.info('API key auth enabled');
  } else {
    log.warn('No API key configured — API is unprotected');
  }

  // GET /api/status
  server.get('/api/status', async () => {
    const deposits = getDeposits();
    const stats = orderManager.getStats();
    const eurUsd = forexPoller.getRate();
    const spreadRec = spreadEngine.getRecommendation();
    const spreadHealth = spreadEngine.isSpreadHealthy();

    return {
      deposits,
      orderStats: stats,
      eurUsd,
      spread: {
        recommendation: spreadRec,
        healthy: spreadHealth,
      },
    };
  });

  // GET /api/pnl
  server.get<{ Querystring: { period?: string } }>('/api/pnl', async (request) => {
    const periodStr = request.query.period;
    let periodDays: number | null = null;

    if (periodStr) {
      const match = periodStr.match(/^(\d+)d$/);
      if (match) periodDays = parseInt(match[1], 10);
    }

    const summary = pnlTracker.getSummary(periodDays);
    const openCycles = pnlTracker.getOpenCycles();
    const recentCycles = pnlTracker.getRecentCycles(10);

    return { summary, openCycles, recentCycles };
  });

  // GET /api/orders
  server.get<{ Querystring: { limit?: string } }>('/api/orders', async (request) => {
    const limit = parseInt(request.query.limit ?? '20', 10);
    const orders = orderManager.getRecentOrders(limit);
    const stats = orderManager.getStats();

    return { orders, stats };
  });

  // GET /api/spread
  server.get('/api/spread', async () => {
    const rec = spreadEngine.getRecommendation();
    const health = spreadEngine.isSpreadHealthy();

    return { recommendation: rec, health };
  });

  // POST /api/spread — manual spread setting (for future use)
  server.post<{ Body: { deposit_id: number; spread_percent: number } }>('/api/spread', async (request, reply) => {
    const { deposit_id, spread_percent } = request.body ?? {};

    if (deposit_id == null || spread_percent == null) {
      reply.code(400).send({ error: 'deposit_id and spread_percent required' });
      return;
    }

    const { min_spread_percent, max_spread_percent } = config.spread;
    if (spread_percent < min_spread_percent || spread_percent > max_spread_percent) {
      reply.code(400).send({
        error: `spread_percent must be between ${min_spread_percent} and ${max_spread_percent}`,
      });
      return;
    }

    // In Phase 2, we only record the intent — actual on-chain TX is Phase 4
    spreadEngine.setCurrentSpread(deposit_id, spread_percent);

    return {
      message: `Spread for deposit #${deposit_id} set to ${spread_percent}%`,
      note: 'On-chain transaction not yet implemented (Phase 4)',
    };
  });

  // GET /api/forex
  server.get('/api/forex', async () => {
    const rate = forexPoller.getRate();
    return { eurUsd: rate };
  });

  // Start listening
  const port = config.api.port;
  await server.listen({ port, host: '127.0.0.1' });
  log.info({ port }, 'REST API server started');
}
