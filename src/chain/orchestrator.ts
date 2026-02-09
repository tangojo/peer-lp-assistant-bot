import { Contract, type JsonRpcProvider } from 'ethers';

// Human-readable ABI fragments for Orchestrator events (ethers v6)
const ORCHESTRATOR_ABI = [
  'event IntentSignaled(bytes32 indexed intentHash, address indexed escrow, uint256 indexed depositId, bytes32 paymentMethod, address owner, address to, uint256 amount, bytes32 fiatCurrency, uint256 conversionRate, uint256 timestamp)',
  'event IntentFulfilled(bytes32 indexed intentHash, address indexed fundsTransferredTo, uint256 amount, bool isManualRelease)',
  'event IntentPruned(bytes32 indexed intentHash)',
];

export function createOrchestratorContract(address: string, provider: JsonRpcProvider): Contract {
  return new Contract(address, ORCHESTRATOR_ABI, provider);
}

export { ORCHESTRATOR_ABI };
