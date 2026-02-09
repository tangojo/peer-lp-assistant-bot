import { Contract, type JsonRpcProvider } from 'ethers';

// Human-readable ABI fragments for Escrow events (ethers v6)
const ESCROW_ABI = [
  'event FundsLocked(uint256 indexed depositId, bytes32 indexed intentHash, uint256 amount, uint256 expiryTime)',
  'event FundsUnlockedAndTransferred(uint256 indexed depositId, bytes32 indexed intentHash, uint256 unlockedAmount, uint256 transferredAmount, address to)',
  'event FundsUnlocked(uint256 indexed depositId, bytes32 indexed intentHash, uint256 amount)',
  'event DepositReceived(uint256 indexed depositId, address indexed depositor, address indexed token, uint256 amount, (uint256 min, uint256 max) intentAmountRange, address delegate, address intentGuardian)',
  'event DepositFundsAdded(uint256 indexed depositId, address indexed depositor, uint256 amount)',
  'event DepositWithdrawn(uint256 indexed depositId, address indexed depositor, uint256 amount)',
];

export function createEscrowContract(address: string, provider: JsonRpcProvider): Contract {
  return new Contract(address, ESCROW_ABI, provider);
}

export { ESCROW_ABI };
