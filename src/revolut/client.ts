import { createChildLogger } from '../utils/logger.js';
import { retry } from '../utils/retry.js';
import type { AppConfig } from '../config/schema.js';

const log = createChildLogger('revolut-client');

export interface RevolutTransaction {
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
      account_id?: string;
      name?: string;
    };
  }[];
}

export interface RevolutAccount {
  id: string;
  name: string;
  balance: number;
  currency: string;
  state: string;
}

export class RevolutClient {
  private apiUrl: string;
  private accessToken: string | null = null;

  constructor(config: AppConfig) {
    this.apiUrl = config.revolut.api_url;
    this.accessToken = process.env.REVOLUT_ACCESS_TOKEN ?? null;

    if (!this.accessToken) {
      log.warn('REVOLUT_ACCESS_TOKEN not set — Revolut integration disabled');
    }
  }

  isConfigured(): boolean {
    return this.accessToken != null;
  }

  /** Get recent transactions (incoming payments) */
  async getTransactions(opts: {
    from?: string;
    to?: string;
    count?: number;
    type?: string;
  } = {}): Promise<RevolutTransaction[]> {
    const params = new URLSearchParams();
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.count) params.set('count', String(opts.count));
    if (opts.type) params.set('type', opts.type);

    const data = await this.request<RevolutTransaction[]>(
      `/transactions?${params.toString()}`,
    );
    return data ?? [];
  }

  /** Get incoming transfers only */
  async getIncomingTransfers(sinceHours = 24): Promise<RevolutTransaction[]> {
    const from = new Date(Date.now() - sinceHours * 60 * 60 * 1000).toISOString();
    const txs = await this.getTransactions({ from, type: 'transfer' });

    // Filter for completed incoming transfers
    return txs.filter(
      (tx) => tx.state === 'completed' && tx.legs.some((leg) => leg.amount > 0),
    );
  }

  /** Get account balances */
  async getAccounts(): Promise<RevolutAccount[]> {
    const data = await this.request<RevolutAccount[]>('/accounts');
    return data ?? [];
  }

  /** Get EUR balance */
  async getEurBalance(): Promise<number | null> {
    const accounts = await this.getAccounts();
    const eurAccount = accounts.find((a) => a.currency === 'EUR');
    return eurAccount?.balance ?? null;
  }

  /** Check token health — warn if expiring soon */
  checkTokenHealth(): { healthy: boolean; daysUntilExpiry: number | null; message?: string } {
    // Revolut Business refresh tokens expire after 90 days
    // We can't know the exact expiry without storing it, so we remind periodically
    const lastRefreshStr = process.env.REVOLUT_TOKEN_REFRESH_DATE;
    if (!lastRefreshStr) {
      return {
        healthy: true,
        daysUntilExpiry: null,
        message: 'REVOLUT_TOKEN_REFRESH_DATE not set — cannot track token expiry',
      };
    }

    const lastRefresh = new Date(lastRefreshStr);
    const daysSinceRefresh = (Date.now() - lastRefresh.getTime()) / (1000 * 60 * 60 * 24);
    const daysUntilExpiry = Math.max(0, 90 - daysSinceRefresh);

    if (daysUntilExpiry <= 7) {
      return {
        healthy: false,
        daysUntilExpiry: Math.round(daysUntilExpiry),
        message: `Revolut token expires in ${Math.round(daysUntilExpiry)} days — refresh NOW`,
      };
    }

    return { healthy: true, daysUntilExpiry: Math.round(daysUntilExpiry) };
  }

  private async request<T>(path: string): Promise<T | null> {
    if (!this.accessToken) return null;

    return retry(
      async () => {
        const res = await fetch(`${this.apiUrl}${path}`, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (res.status === 401) {
          log.error('Revolut API returned 401 — token may be expired');
          return null as unknown as T;
        }

        if (!res.ok) {
          throw new Error(`Revolut API ${res.status}: ${await res.text()}`);
        }

        return (await res.json()) as T;
      },
      { retries: 2, delayMs: 2000, label: `revolut:${path}` },
    );
  }
}
