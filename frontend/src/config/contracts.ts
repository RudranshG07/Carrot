// Stellar Soroban Network Configuration
export const STELLAR_CONFIG = {
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkName: 'Stellar Testnet',
  explorerUrl: 'https://stellar.expert/explorer/testnet',
};

// Contract IDs - Deployed to Stellar Testnet
export const CONTRACTS = {
  gpuRegistry: 'CDPGJH4OHPUSGUHUZA2CFJXWTGPGPMEIPJVKVKH5UYDUY4KTHLTYYIWZ',
  jobMarketplace: 'CBAIX6OR64QCYOVWCIOWKLE2QUAVWW5HHUQOE5LX2VXLGKIVKML5EZ76',
  xlmToken: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', // Native XLM wrapped token on testnet
};

// Check if contracts are deployed
export function areContractsDeployed(): boolean {
  return CONTRACTS.gpuRegistry !== '' && CONTRACTS.jobMarketplace !== '';
}

// GPU struct matching Soroban contract
export interface GPU {
  provider: string;
  model: string;
  vram_gb: number;
  price_per_hour: bigint;
  available: boolean;
  total_jobs: number;
  registered_at: number;
}

// Job struct matching Soroban contract
export interface Job {
  job_id: number;
  consumer: string;
  gpu_id: number;
  description: string;
  compute_hours: number;
  payment_amount: bigint;
  provider: string;
  status: number; // 0=Open, 1=Claimed, 2=Completed, 3=Cancelled
  created_at: number;
  claimed_at: number;
  completed_at: number;
  result_hash: string;
}

export const JobStatus = {
  Open: 0,
  Claimed: 1,
  Completed: 2,
  Cancelled: 3,
} as const;

export function getJobStatusName(status: number): string {
  switch (status) {
    case 0: return 'Open';
    case 1: return 'In Progress';
    case 2: return 'Completed';
    case 3: return 'Cancelled';
    default: return 'Unknown';
  }
}

// Convert stroops to XLM - handles bigint, number, or string
export function stroopsToXLM(stroops: bigint | number | string): string {
  const value = typeof stroops === 'bigint' ? Number(stroops) :
                typeof stroops === 'string' ? Number(stroops) : stroops;
  return (value / 10000000).toFixed(7);
}

// Convert XLM to stroops
export function xlmToStroops(xlm: string): bigint {
  return BigInt(Math.floor(parseFloat(xlm) * 10000000));
}
