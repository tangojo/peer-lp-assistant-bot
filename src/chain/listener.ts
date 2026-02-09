import { JsonRpcProvider, WebSocketProvider, type Contract, type Log, type EventLog } from 'ethers';
import { createEscrowContract } from './escrow.js';
import { createOrchestratorContract } from './orchestrator.js';
import { createChildLogger } from '../utils/logger.js';
import type { AppConfig } from '../config/schema.js';
import { EventEmitter } from 'node:events';

const log = createChildLogger('chain-listener');

export interface IntentSignaledEvent {
  intentHash: string;
  escrow: string;
  depositId: number;
  paymentMethod: string;
  owner: string;
  to: string;
  amount: bigint;
  fiatCurrency: string;
  conversionRate: bigint;
  timestamp: bigint;
  txHash: string;
}

export interface FundsLockedEvent {
  depositId: number;
  intentHash: string;
  amount: bigint;
  expiryTime: bigint;
  txHash: string;
}

export interface FundsReleasedEvent {
  depositId: number;
  intentHash: string;
  unlockedAmount: bigint;
  transferredAmount: bigint;
  to: string;
  txHash: string;
}

export interface IntentFulfilledEvent {
  intentHash: string;
  fundsTransferredTo: string;
  amount: bigint;
  isManualRelease: boolean;
  txHash: string;
}

export type ChainEvents = {
  intentSignaled: [IntentSignaledEvent];
  fundsLocked: [FundsLockedEvent];
  fundsReleased: [FundsReleasedEvent];
  intentFulfilled: [IntentFulfilledEvent];
  error: [Error];
};

export class ChainListener extends EventEmitter<ChainEvents> {
  private provider: JsonRpcProvider | WebSocketProvider | null = null;
  private escrow: Contract | null = null;
  private orchestrator: Contract | null = null;
  private config: AppConfig;
  private depositIds: Set<number>;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastBlock = 0;

  constructor(config: AppConfig) {
    super();
    this.config = config;
    this.depositIds = new Set(config.peer.deposit_ids);
  }

  async start(): Promise<void> {
    const { rpc_url, rpc_ws } = this.config.chain;

    // Prefer WebSocket if available, fall back to HTTP polling
    if (rpc_ws) {
      try {
        this.provider = new WebSocketProvider(rpc_ws);
        log.info({ url: rpc_ws }, 'Connected via WebSocket');
      } catch (err) {
        log.warn({ err }, 'WebSocket connection failed, falling back to HTTP polling');
        this.provider = new JsonRpcProvider(rpc_url);
      }
    } else {
      this.provider = new JsonRpcProvider(rpc_url);
      log.info({ url: rpc_url }, 'Connected via HTTP polling');
    }

    const network = await this.provider.getNetwork();
    log.info({ chainId: Number(network.chainId) }, 'Connected to chain');

    this.escrow = createEscrowContract(
      this.config.peer.escrow_address,
      this.provider as JsonRpcProvider,
    );
    this.orchestrator = createOrchestratorContract(
      this.config.peer.orchestrator_address,
      this.provider as JsonRpcProvider,
    );

    this.lastBlock = await this.provider.getBlockNumber();
    log.info({ block: this.lastBlock }, 'Starting from block');

    // If WebSocket, use real-time listeners
    if (this.provider instanceof WebSocketProvider) {
      this.setupRealtimeListeners();
    } else {
      // HTTP polling every 10 seconds
      this.startPolling(10_000);
    }
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.escrow) {
      await this.escrow.removeAllListeners();
    }
    if (this.orchestrator) {
      await this.orchestrator.removeAllListeners();
    }
    if (this.provider instanceof WebSocketProvider) {
      await this.provider.destroy();
    }

    log.info('Chain listener stopped');
  }

  private setupRealtimeListeners(): void {
    if (!this.orchestrator || !this.escrow) return;

    this.orchestrator.on('IntentSignaled', (...args: unknown[]) => {
      this.handleIntentSignaled(args);
    });

    this.orchestrator.on('IntentFulfilled', (...args: unknown[]) => {
      this.handleIntentFulfilled(args);
    });

    this.escrow.on('FundsLocked', (...args: unknown[]) => {
      this.handleFundsLocked(args);
    });

    this.escrow.on('FundsUnlockedAndTransferred', (...args: unknown[]) => {
      this.handleFundsReleased(args);
    });

    log.info('Real-time event listeners active');
  }

  private startPolling(intervalMs: number): void {
    this.pollInterval = setInterval(() => this.poll(), intervalMs);
    log.info({ intervalMs }, 'Polling started');
  }

  private async poll(): Promise<void> {
    if (!this.orchestrator || !this.escrow || !this.provider) return;

    try {
      const currentBlock = await this.provider.getBlockNumber();
      if (currentBlock <= this.lastBlock) return;

      const fromBlock = this.lastBlock + 1;
      const toBlock = currentBlock;

      // Query Orchestrator events
      const intentFilter = this.orchestrator.filters.IntentSignaled();
      const intentEvents = await this.orchestrator.queryFilter(intentFilter, fromBlock, toBlock);
      for (const event of intentEvents) {
        this.handleIntentSignaled(this.extractArgs(event));
      }

      const fulfilledFilter = this.orchestrator.filters.IntentFulfilled();
      const fulfilledEvents = await this.orchestrator.queryFilter(fulfilledFilter, fromBlock, toBlock);
      for (const event of fulfilledEvents) {
        this.handleIntentFulfilled(this.extractArgs(event));
      }

      // Query Escrow events
      const lockedFilter = this.escrow.filters.FundsLocked();
      const lockedEvents = await this.escrow.queryFilter(lockedFilter, fromBlock, toBlock);
      for (const event of lockedEvents) {
        this.handleFundsLocked(this.extractArgs(event));
      }

      const releasedFilter = this.escrow.filters.FundsUnlockedAndTransferred();
      const releasedEvents = await this.escrow.queryFilter(releasedFilter, fromBlock, toBlock);
      for (const event of releasedEvents) {
        this.handleFundsReleased(this.extractArgs(event));
      }

      this.lastBlock = toBlock;
    } catch (err) {
      log.error({ err }, 'Polling error');
      this.emit('error', err as Error);
    }
  }

  private extractArgs(event: Log | EventLog): unknown[] {
    if ('args' in event && event.args) {
      return [...event.args, event];
    }
    return [event];
  }

  private handleIntentSignaled(args: unknown[]): void {
    try {
      const [intentHash, escrow, depositId, paymentMethod, owner, to, amount, fiatCurrency, conversionRate, timestamp] = args as [
        string, string, bigint, string, string, string, bigint, string, bigint, bigint, EventLog?,
      ];

      const depId = Number(depositId);
      if (!this.depositIds.has(depId)) return; // Not our deposit

      const event: IntentSignaledEvent = {
        intentHash,
        escrow,
        depositId: depId,
        paymentMethod,
        owner,
        to,
        amount,
        fiatCurrency,
        conversionRate,
        timestamp,
        txHash: (args[args.length - 1] as EventLog)?.transactionHash ?? '',
      };

      log.info({ intentHash, depositId: depId, amount: amount.toString() }, 'IntentSignaled');
      this.emit('intentSignaled', event);
    } catch (err) {
      log.error({ err }, 'Error handling IntentSignaled');
    }
  }

  private handleFundsLocked(args: unknown[]): void {
    try {
      const [depositId, intentHash, amount, expiryTime] = args as [
        bigint, string, bigint, bigint, EventLog?,
      ];

      const depId = Number(depositId);
      if (!this.depositIds.has(depId)) return;

      const event: FundsLockedEvent = {
        depositId: depId,
        intentHash,
        amount,
        expiryTime,
        txHash: (args[args.length - 1] as EventLog)?.transactionHash ?? '',
      };

      log.info({ intentHash, depositId: depId, amount: amount.toString() }, 'FundsLocked');
      this.emit('fundsLocked', event);
    } catch (err) {
      log.error({ err }, 'Error handling FundsLocked');
    }
  }

  private handleFundsReleased(args: unknown[]): void {
    try {
      const [depositId, intentHash, unlockedAmount, transferredAmount, to] = args as [
        bigint, string, bigint, bigint, string, EventLog?,
      ];

      const depId = Number(depositId);
      if (!this.depositIds.has(depId)) return;

      const event: FundsReleasedEvent = {
        depositId: depId,
        intentHash,
        unlockedAmount,
        transferredAmount,
        to,
        txHash: (args[args.length - 1] as EventLog)?.transactionHash ?? '',
      };

      log.info({ intentHash, depositId: depId, transferredAmount: transferredAmount.toString() }, 'FundsReleased');
      this.emit('fundsReleased', event);
    } catch (err) {
      log.error({ err }, 'Error handling FundsReleased');
    }
  }

  private handleIntentFulfilled(args: unknown[]): void {
    try {
      const [intentHash, fundsTransferredTo, amount, isManualRelease] = args as [
        string, string, bigint, boolean, EventLog?,
      ];

      const event: IntentFulfilledEvent = {
        intentHash,
        fundsTransferredTo,
        amount,
        isManualRelease,
        txHash: (args[args.length - 1] as EventLog)?.transactionHash ?? '',
      };

      log.info({ intentHash, amount: amount.toString() }, 'IntentFulfilled');
      this.emit('intentFulfilled', event);
    } catch (err) {
      log.error({ err }, 'Error handling IntentFulfilled');
    }
  }
}
