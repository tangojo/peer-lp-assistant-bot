import { Wallet, JsonRpcProvider } from 'ethers';
import { createChildLogger } from '../utils/logger.js';
import type { AppConfig } from '../config/schema.js';

const log = createChildLogger('signer');

let wallet: Wallet | null = null;

export function initSigner(config: AppConfig): Wallet | null {
  const privateKey = process.env.PEER_LP_PRIVATE_KEY;

  if (!privateKey) {
    log.warn('PEER_LP_PRIVATE_KEY not set — on-chain write operations disabled');
    return null;
  }

  const provider = new JsonRpcProvider(config.chain.rpc_url);
  wallet = new Wallet(privateKey, provider);

  log.info({ address: wallet.address }, 'Wallet signer initialized');
  return wallet;
}

export function getSigner(): Wallet | null {
  return wallet;
}

export function requireSigner(): Wallet {
  if (!wallet) {
    throw new Error('Wallet signer not initialized. Set PEER_LP_PRIVATE_KEY env var.');
  }
  return wallet;
}
