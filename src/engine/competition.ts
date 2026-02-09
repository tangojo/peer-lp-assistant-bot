import { Contract, JsonRpcProvider, formatUnits, keccak256, toUtf8Bytes } from 'ethers';
import { createChildLogger } from '../utils/logger.js';
import type { AppConfig } from '../config/schema.js';

const log = createChildLogger('competition');

const PROTOCOL_VIEWER_ADDRESS = '0x30B03De22328074Fbe8447C425ae988797146606';

const PROTOCOL_VIEWER_ABI = [
  'function getDeposit(uint256 _depositId) view returns ((uint256 depositId, (address depositor, address delegate, address token, (uint256 min, uint256 max) intentAmountRange, bool acceptingIntents, uint256 remainingDeposits, uint256 outstandingIntentAmount, address intentGuardian, bool retainOnEmpty) deposit, uint256 availableLiquidity, (bytes32 paymentMethod, (address intentGatingService, bytes32 payeeDetails, bytes data) verificationData, (bytes32 code, uint256 minConversionRate)[] currencies)[] paymentMethods, bytes32[] intentHashes))',
  'function getDepositFromIds(uint256[] _depositIds) view returns ((uint256 depositId, (address depositor, address delegate, address token, (uint256 min, uint256 max) intentAmountRange, bool acceptingIntents, uint256 remainingDeposits, uint256 outstandingIntentAmount, address intentGuardian, bool retainOnEmpty) deposit, uint256 availableLiquidity, (bytes32 paymentMethod, (address intentGatingService, bytes32 payeeDetails, bytes data) verificationData, (bytes32 code, uint256 minConversionRate)[] currencies)[] paymentMethods, bytes32[] intentHashes)[])',
];

const ESCROW_COUNTER_ABI = [
  'function depositCounter() view returns (uint256)',
];

export interface CompetitorDeposit {
  depositId: number;
  depositor: string;
  availableLiquidity: number;
  acceptingIntents: boolean;
  minConversionRate: bigint | null;
  paymentMethod: string;
  currency: string;
}

export interface CompetitionSnapshot {
  competitors: CompetitorDeposit[];
  avgRate: bigint | null;
  lowestRate: bigint | null;
  highestRate: bigint | null;
  totalLiquidity: number;
  timestamp: Date;
}

export class CompetitionAnalyzer {
  private viewer: Contract;
  private escrow: Contract;
  private config: AppConfig;
  private targetPmHash: string;
  private targetCurHash: string;
  private lastSnapshot: CompetitionSnapshot | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    const provider = new JsonRpcProvider(config.chain.rpc_url);
    this.viewer = new Contract(PROTOCOL_VIEWER_ADDRESS, PROTOCOL_VIEWER_ABI, provider);
    this.escrow = new Contract(config.peer.escrow_address, ESCROW_COUNTER_ABI, provider);
    this.targetPmHash = keccak256(toUtf8Bytes(config.peer.payment_method));
    this.targetCurHash = keccak256(toUtf8Bytes(config.peer.currency));
  }

  /** Scan all deposits to find competitors with same payment method + currency */
  async analyze(): Promise<CompetitionSnapshot> {
    const totalDeposits = Number(await this.escrow.depositCounter());
    log.info({ totalDeposits }, 'Scanning deposits for competitors');

    const competitors: CompetitorDeposit[] = [];
    const ownDepositIds = new Set(this.config.peer.deposit_ids);

    // Scan in batches of 50
    const batchSize = 50;
    for (let start = 0; start < totalDeposits; start += batchSize) {
      const ids = Array.from(
        { length: Math.min(batchSize, totalDeposits - start) },
        (_, i) => start + i,
      );

      try {
        const deposits = await this.viewer.getDepositFromIds(ids);

        for (const dv of deposits) {
          if (!dv.deposit.acceptingIntents) continue;

          const availLiq = parseFloat(formatUnits(dv.availableLiquidity, 6));
          if (availLiq < 10) continue; // Ignore dust deposits

          // Skip own deposits
          if (ownDepositIds.has(Number(dv.depositId))) continue;

          // Check if this deposit has our target payment method + currency
          for (const pm of dv.paymentMethods) {
            if (pm.paymentMethod !== this.targetPmHash) continue;

            for (const cur of pm.currencies) {
              if (cur.code !== this.targetCurHash) continue;

              competitors.push({
                depositId: Number(dv.depositId),
                depositor: dv.deposit.depositor,
                availableLiquidity: availLiq,
                acceptingIntents: true,
                minConversionRate: cur.minConversionRate,
                paymentMethod: this.config.peer.payment_method,
                currency: this.config.peer.currency,
              });
            }
          }
        }
      } catch (err) {
        log.warn({ start, err }, 'Batch fetch failed, skipping');
      }
    }

    // Calculate statistics
    const rates = competitors
      .map((c) => c.minConversionRate)
      .filter((r): r is bigint => r != null);

    const snapshot: CompetitionSnapshot = {
      competitors,
      avgRate: rates.length > 0 ? rates.reduce((a, b) => a + b, 0n) / BigInt(rates.length) : null,
      lowestRate: rates.length > 0 ? rates.reduce((a, b) => (a < b ? a : b)) : null,
      highestRate: rates.length > 0 ? rates.reduce((a, b) => (a > b ? a : b)) : null,
      totalLiquidity: competitors.reduce((sum, c) => sum + c.availableLiquidity, 0),
      timestamp: new Date(),
    };

    this.lastSnapshot = snapshot;

    log.info(
      {
        competitors: competitors.length,
        totalLiquidity: snapshot.totalLiquidity,
      },
      'Competition analysis complete',
    );

    return snapshot;
  }

  getLastSnapshot(): CompetitionSnapshot | null {
    return this.lastSnapshot;
  }
}
