import { Contract, type Wallet, parseUnits, formatUnits } from 'ethers';
import { createChildLogger } from '../utils/logger.js';
import type { AppConfig } from '../config/schema.js';
import { upsertDeposit } from '../db/queries.js';

const log = createChildLogger('escrow-manager');

// Escrow ABI — write + read functions needed for LP management
const ESCROW_WRITE_ABI = [
  // Write
  'function addFunds(uint256 _depositId, uint256 _amount)',
  'function removeFunds(uint256 _depositId, uint256 _amount)',
  'function withdrawDeposit(uint256 _depositId)',
  'function setCurrencyMinRate(uint256 _depositId, bytes32 _paymentMethod, bytes32 _fiatCurrency, uint256 _newMinConversionRate)',
  'function setAcceptingIntents(uint256 _depositId, bool _acceptingIntents)',
  'function setIntentRange(uint256 _depositId, (uint256 min, uint256 max) _intentAmountRange)',
  // Read
  'function getDeposit(uint256 _depositId) view returns ((address depositor, address delegate, address token, (uint256 min, uint256 max) intentAmountRange, bool acceptingIntents, uint256 remainingDeposits, uint256 outstandingIntentAmount, address intentGuardian, bool retainOnEmpty))',
  'function getAccountDeposits(address _account) view returns (uint256[])',
  'function getDepositCurrencyMinRate(uint256 _depositId, bytes32 _paymentMethod, bytes32 _currencyCode) view returns (uint256)',
  'function depositCounter() view returns (uint256)',
];

// USDC on Base
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;

// ERC20 approve ABI
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

export class EscrowManager {
  private escrow: Contract;
  private usdc: Contract;
  private signer: Wallet;
  private config: AppConfig;

  constructor(config: AppConfig, signer: Wallet) {
    this.config = config;
    this.signer = signer;
    this.escrow = new Contract(config.peer.escrow_address, ESCROW_WRITE_ABI, signer);
    this.usdc = new Contract(USDC_ADDRESS, ERC20_ABI, signer);
  }

  /** Get USDC balance of the signer wallet */
  async getWalletBalance(): Promise<number> {
    const balance = await this.usdc.balanceOf(this.signer.address);
    return parseFloat(formatUnits(balance, USDC_DECIMALS));
  }

  /** Get on-chain deposit info and sync to local DB */
  async syncDeposit(depositId: number): Promise<{
    depositor: string;
    remainingDeposits: number;
    outstandingIntentAmount: number;
    acceptingIntents: boolean;
  }> {
    const result = await this.escrow.getDeposit(depositId);

    const remaining = parseFloat(formatUnits(result.remainingDeposits, USDC_DECIMALS));
    const outstanding = parseFloat(formatUnits(result.outstandingIntentAmount, USDC_DECIMALS));

    // Sync to local DB
    upsertDeposit({
      deposit_id: depositId,
      wallet_address: result.depositor,
      amount_available: remaining,
      status: result.acceptingIntents ? 'active' : 'paused',
    });

    log.info({ depositId, remaining, outstanding, accepting: result.acceptingIntents }, 'Deposit synced');

    return {
      depositor: result.depositor,
      remainingDeposits: remaining,
      outstandingIntentAmount: outstanding,
      acceptingIntents: result.acceptingIntents,
    };
  }

  /** Get current min conversion rate (spread) for a deposit */
  async getCurrentRate(depositId: number, paymentMethod: string, currency: string): Promise<bigint> {
    const pmHash = this.hashString(paymentMethod);
    const curHash = this.hashString(currency);
    return await this.escrow.getDepositCurrencyMinRate(depositId, pmHash, curHash);
  }

  /** Set the minimum conversion rate (spread control) on-chain */
  async setCurrencyMinRate(
    depositId: number,
    newRate: bigint,
  ): Promise<string> {
    const pmHash = this.hashString(this.config.peer.payment_method);
    const curHash = this.hashString(this.config.peer.currency);

    log.info({ depositId, newRate: newRate.toString() }, 'Setting currency min rate on-chain');

    const tx = await this.escrow.setCurrencyMinRate(depositId, pmHash, curHash, newRate);
    const receipt = await tx.wait();

    log.info({ depositId, txHash: receipt.hash }, 'Currency min rate updated');
    return receipt.hash;
  }

  /** Add funds to an existing deposit (requires USDC approval) */
  async addFunds(depositId: number, usdcAmount: number): Promise<string> {
    const amount = parseUnits(usdcAmount.toString(), USDC_DECIMALS);

    // Check and approve USDC if needed
    await this.ensureAllowance(amount);

    log.info({ depositId, usdcAmount }, 'Adding funds to deposit');

    const tx = await this.escrow.addFunds(depositId, amount);
    const receipt = await tx.wait();

    log.info({ depositId, usdcAmount, txHash: receipt.hash }, 'Funds added');
    return receipt.hash;
  }

  /** Remove funds from a deposit */
  async removeFunds(depositId: number, usdcAmount: number): Promise<string> {
    const amount = parseUnits(usdcAmount.toString(), USDC_DECIMALS);

    log.info({ depositId, usdcAmount }, 'Removing funds from deposit');

    const tx = await this.escrow.removeFunds(depositId, amount);
    const receipt = await tx.wait();

    log.info({ depositId, usdcAmount, txHash: receipt.hash }, 'Funds removed');
    return receipt.hash;
  }

  /** Withdraw all funds and close deposit */
  async withdrawDeposit(depositId: number): Promise<string> {
    log.info({ depositId }, 'Withdrawing entire deposit');

    const tx = await this.escrow.withdrawDeposit(depositId);
    const receipt = await tx.wait();

    log.info({ depositId, txHash: receipt.hash }, 'Deposit withdrawn');
    return receipt.hash;
  }

  /** Pause/resume accepting intents */
  async setAcceptingIntents(depositId: number, accepting: boolean): Promise<string> {
    log.info({ depositId, accepting }, 'Setting accepting intents');

    const tx = await this.escrow.setAcceptingIntents(depositId, accepting);
    const receipt = await tx.wait();

    log.info({ depositId, accepting, txHash: receipt.hash }, 'Accepting intents updated');
    return receipt.hash;
  }

  /** Get all deposit IDs owned by the signer */
  async getOwnDepositIds(): Promise<number[]> {
    const ids: bigint[] = await this.escrow.getAccountDeposits(this.signer.address);
    return ids.map((id) => Number(id));
  }

  /** Sync all owned deposits to local DB */
  async syncAllDeposits(): Promise<void> {
    for (const depositId of this.config.peer.deposit_ids) {
      try {
        await this.syncDeposit(depositId);
      } catch (err) {
        log.error({ depositId, err }, 'Failed to sync deposit');
      }
    }
  }

  private async ensureAllowance(amount: bigint): Promise<void> {
    const currentAllowance = await this.usdc.allowance(
      this.signer.address,
      this.config.peer.escrow_address,
    );

    if (currentAllowance < amount) {
      log.info({ amount: amount.toString() }, 'Approving USDC for Escrow');
      const tx = await this.usdc.approve(this.config.peer.escrow_address, amount);
      await tx.wait();
      log.info('USDC approval confirmed');
    }
  }

  private hashString(value: string): string {
    // keccak256 of the string — matches @zkp2p/contracts-v2 utils
    const { keccak256, toUtf8Bytes } = require('ethers') as typeof import('ethers');
    return keccak256(toUtf8Bytes(value));
  }
}
