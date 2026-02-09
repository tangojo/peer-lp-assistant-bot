import Fastify, { type FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createChildLogger } from '../utils/logger.js';
import { EventEmitter } from 'node:events';

const log = createChildLogger('revolut-webhook');

export interface RevolutWebhookPayload {
  event: string;
  timestamp: string;
  data: {
    id: string;
    type: string;
    state: string;
    reference: string;
    created_at: string;
    completed_at: string | null;
    legs: {
      amount: number;
      currency: string;
      description: string;
      counterparty?: {
        name?: string;
      };
    }[];
  };
}

export type WebhookEvents = {
  transactionCreated: [RevolutWebhookPayload['data']];
};

export class RevolutWebhookServer extends EventEmitter<WebhookEvents> {
  private server: FastifyInstance | null = null;
  private port: number;
  private signingSecret: string | null;
  private processedIds = new Set<string>();

  constructor(port: number) {
    super();
    this.port = port;
    this.signingSecret = process.env.REVOLUT_WEBHOOK_SECRET ?? null;
    if (!this.signingSecret) {
      log.warn('REVOLUT_WEBHOOK_SECRET not set — webhook signature validation disabled');
    }
  }

  async start(): Promise<void> {
    this.server = Fastify({ logger: false });

    this.server.post('/webhook/revolut', async (request, reply) => {
      // Validate signature if secret is configured
      if (this.signingSecret) {
        const signature = request.headers['revolut-signature'] as string | undefined;
        if (!this.validateSignature(request.body as string, signature)) {
          log.warn('Invalid webhook signature');
          reply.code(401).send({ error: 'Invalid signature' });
          return;
        }
      }

      const payload = request.body as RevolutWebhookPayload;

      if (!payload?.event || !payload?.data?.id) {
        reply.code(400).send({ error: 'Invalid payload' });
        return;
      }

      // Idempotency check
      if (this.processedIds.has(payload.data.id)) {
        log.debug({ txId: payload.data.id }, 'Duplicate webhook, skipping');
        reply.code(200).send({ status: 'already_processed' });
        return;
      }

      this.processedIds.add(payload.data.id);

      // Keep set from growing unbounded (max 1000 entries)
      if (this.processedIds.size > 1000) {
        const first = this.processedIds.values().next().value;
        if (first) this.processedIds.delete(first);
      }

      if (payload.event === 'TransactionCreated' || payload.event === 'TransactionStateChanged') {
        const tx = payload.data;
        const isIncoming = tx.legs?.some((leg) => leg.amount > 0);

        if (isIncoming && tx.state === 'completed') {
          log.info(
            {
              txId: tx.id,
              amount: tx.legs[0]?.amount,
              currency: tx.legs[0]?.currency,
              counterparty: tx.legs[0]?.counterparty?.name,
            },
            'Incoming payment received',
          );

          this.emit('transactionCreated', tx);
        }
      }

      reply.code(200).send({ status: 'ok' });
    });

    // Health check
    this.server.get('/webhook/health', async () => ({ status: 'ok' }));

    await this.server.listen({ port: this.port, host: '127.0.0.1' });
    log.info({ port: this.port }, 'Revolut webhook server started');
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.close();
      this.server = null;
    }
    log.info('Revolut webhook server stopped');
  }

  private validateSignature(body: string, signature: string | undefined): boolean {
    if (!this.signingSecret || !signature) return false;

    const expected = createHmac('sha256', this.signingSecret)
      .update(typeof body === 'string' ? body : JSON.stringify(body))
      .digest('hex');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }
}
