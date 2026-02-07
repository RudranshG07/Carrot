import type { GPU, Job } from '../config/contracts';
import { STELLAR_CONFIG, CONTRACTS } from '../config/contracts';
import {
  Contract,
  TransactionBuilder,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  Transaction,
  Account,
  rpc as SorobanRpc,
} from '@stellar/stellar-sdk';
import freighterApi from '@stellar/freighter-api';

const rpcServer = new SorobanRpc.Server(STELLAR_CONFIG.rpcUrl);

// Helper to build and sign transactions
async function invokeContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  publicKey: string
): Promise<xdr.ScVal | null> {
  const account = await rpcServer.getAccount(publicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await rpcServer.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();

  const signedXdr = await freighterApi.signTransaction(preparedTx.toXDR(), {
    networkPassphrase: STELLAR_CONFIG.networkPassphrase,
  });

  const signedTx = TransactionBuilder.fromXDR(
    signedXdr.signedTxXdr,
    STELLAR_CONFIG.networkPassphrase
  ) as Transaction;

  const sendResult = await rpcServer.sendTransaction(signedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction failed: ${sendResult.errorResult}`);
  }

  let getResult = await rpcServer.getTransaction(sendResult.hash);
  while (getResult.status === 'NOT_FOUND') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    getResult = await rpcServer.getTransaction(sendResult.hash);
  }

  if (getResult.status === 'SUCCESS' && getResult.returnValue) {
    return getResult.returnValue;
  }

  if (getResult.status === 'FAILED') {
    throw new Error('Transaction failed on chain');
  }

  return null;
}

// Read-only contract call
async function readContract(
  contractId: string,
  method: string,
  args: xdr.ScVal[]
): Promise<xdr.ScVal | null> {
  try {
    const tempAccount = new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      '0'
    );
    const contract = new Contract(contractId);

    const tx = new TransactionBuilder(tempAccount, {
      fee: '100',
      networkPassphrase: STELLAR_CONFIG.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simResult = await rpcServer.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simResult)) {
      return null;
    }

    if (SorobanRpc.Api.isSimulationSuccess(simResult) && simResult.result) {
      return simResult.result.retval;
    }

    return null;
  } catch (error) {
    console.error('Contract read error:', error);
    return null;
  }
}

// Get XLM balance using Horizon API
export async function getBalance(publicKey: string): Promise<string> {
  try {
    const response = await fetch(
      `https://horizon-testnet.stellar.org/accounts/${publicKey}`
    );

    if (!response.ok) {
      return '0';
    }

    const data = await response.json();
    const xlmBalance = data.balances?.find(
      (b: { asset_type: string }) => b.asset_type === 'native'
    );
    return xlmBalance ? xlmBalance.balance : '0';
  } catch {
    return '0';
  }
}

// Helper to convert status from contract response
function parseJobStatus(status: unknown): number {
  if (typeof status === 'number') return status;
  if (typeof status === 'object' && status !== null) {
    if ('Open' in status) return 0;
    if ('Claimed' in status) return 1;
    if ('Completed' in status) return 2;
    if ('Cancelled' in status) return 3;
  }
  return 0;
}

// ============ GPU Registry Functions ============

export async function registerGPU(
  publicKey: string,
  model: string,
  vramGb: number,
  pricePerHour: bigint
): Promise<number> {
  const args = [
    Address.fromString(publicKey).toScVal(),
    nativeToScVal(model, { type: 'string' }),
    nativeToScVal(vramGb, { type: 'u32' }),
    nativeToScVal(pricePerHour, { type: 'i128' }),
  ];

  const result = await invokeContract(CONTRACTS.gpuRegistry, 'register_gpu', args, publicKey);

  if (result) {
    return scValToNative(result) as number;
  }
  throw new Error('Failed to register GPU');
}

export async function setGPUAvailability(
  publicKey: string,
  gpuId: number,
  available: boolean
): Promise<void> {
  const args = [
    Address.fromString(publicKey).toScVal(),
    nativeToScVal(gpuId, { type: 'u32' }),
    nativeToScVal(available, { type: 'bool' }),
  ];

  await invokeContract(CONTRACTS.gpuRegistry, 'set_availability', args, publicKey);
}

export async function updateGPUPrice(
  publicKey: string,
  gpuId: number,
  newPrice: bigint
): Promise<void> {
  const args = [
    Address.fromString(publicKey).toScVal(),
    nativeToScVal(gpuId, { type: 'u32' }),
    nativeToScVal(newPrice, { type: 'i128' }),
  ];

  await invokeContract(CONTRACTS.gpuRegistry, 'update_price', args, publicKey);
}

export async function getGPU(gpuId: number): Promise<(GPU & { id: number }) | null> {
  try {
    const args = [nativeToScVal(gpuId, { type: 'u32' })];
    const result = await readContract(CONTRACTS.gpuRegistry, 'get_gpu', args);

    if (result) {
      const gpu = scValToNative(result) as Record<string, unknown>;

      let pricePerHour: bigint;
      const rawPrice = gpu.price_per_hour;
      if (typeof rawPrice === 'bigint') {
        pricePerHour = rawPrice;
      } else if (typeof rawPrice === 'string') {
        pricePerHour = BigInt(rawPrice);
      } else if (typeof rawPrice === 'number') {
        pricePerHour = BigInt(rawPrice);
      } else {
        pricePerHour = BigInt(0);
      }

      return {
        id: gpuId,
        provider: String(gpu.provider),
        model: String(gpu.model),
        vram_gb: Number(gpu.vram_gb),
        price_per_hour: pricePerHour,
        available: Boolean(gpu.available),
        total_jobs: Number(gpu.total_jobs),
        registered_at: Number(gpu.registered_at),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function getProviderGPUs(provider: string): Promise<number[]> {
  try {
    const args = [Address.fromString(provider).toScVal()];
    const result = await readContract(CONTRACTS.gpuRegistry, 'get_provider_gpus', args);
    if (result) {
      return scValToNative(result) as number[];
    }
  } catch {
    return [];
  }
  return [];
}

export async function getNextGPUId(): Promise<number> {
  try {
    const result = await readContract(CONTRACTS.gpuRegistry, 'get_next_gpu_id', []);
    if (result) {
      return scValToNative(result) as number;
    }
  } catch {
    return 0;
  }
  return 0;
}

export async function getAllAvailableGPUs(): Promise<(GPU & { id: number })[]> {
  const gpus: (GPU & { id: number })[] = [];
  const nextId = await getNextGPUId();

  for (let i = 0; i < nextId; i++) {
    const gpu = await getGPU(i);
    if (gpu && gpu.available) {
      gpus.push(gpu);
    }
  }

  return gpus;
}

// ============ Job Marketplace Functions ============

export async function postJob(
  publicKey: string,
  gpuId: number,
  description: string,
  computeHours: number,
  paymentAmount: bigint
): Promise<number> {
  const args = [
    Address.fromString(publicKey).toScVal(),
    nativeToScVal(gpuId, { type: 'u32' }),
    nativeToScVal(description, { type: 'string' }),
    nativeToScVal(computeHours, { type: 'u32' }),
    nativeToScVal(paymentAmount, { type: 'i128' }),
  ];

  const result = await invokeContract(CONTRACTS.jobMarketplace, 'post_job', args, publicKey);

  if (result) {
    return scValToNative(result) as number;
  }
  throw new Error('Failed to post job');
}

export async function claimJob(publicKey: string, jobId: number): Promise<void> {
  const args = [
    Address.fromString(publicKey).toScVal(),
    nativeToScVal(jobId, { type: 'u32' }),
  ];

  await invokeContract(CONTRACTS.jobMarketplace, 'claim_job', args, publicKey);
}

export async function completeJob(
  publicKey: string,
  jobId: number,
  resultHash: string
): Promise<void> {
  const args = [
    Address.fromString(publicKey).toScVal(),
    nativeToScVal(jobId, { type: 'u32' }),
    nativeToScVal(resultHash, { type: 'string' }),
  ];

  await invokeContract(CONTRACTS.jobMarketplace, 'complete_job', args, publicKey);
}

export async function cancelJob(publicKey: string, jobId: number): Promise<void> {
  const args = [
    Address.fromString(publicKey).toScVal(),
    nativeToScVal(jobId, { type: 'u32' }),
  ];

  await invokeContract(CONTRACTS.jobMarketplace, 'cancel_job', args, publicKey);
}

export async function getJob(jobId: number): Promise<Job | null> {
  try {
    const args = [nativeToScVal(jobId, { type: 'u32' })];
    const result = await readContract(CONTRACTS.jobMarketplace, 'get_job', args);

    if (result) {
      const job = scValToNative(result) as Record<string, unknown>;

      let paymentAmount: bigint;
      const rawPayment = job.payment_amount;
      if (typeof rawPayment === 'bigint') {
        paymentAmount = rawPayment;
      } else if (typeof rawPayment === 'string') {
        paymentAmount = BigInt(rawPayment);
      } else if (typeof rawPayment === 'number') {
        paymentAmount = BigInt(rawPayment);
      } else {
        paymentAmount = BigInt(0);
      }

      return {
        job_id: Number(job.job_id),
        consumer: String(job.consumer),
        gpu_id: Number(job.gpu_id),
        description: String(job.description),
        compute_hours: Number(job.compute_hours),
        payment_amount: paymentAmount,
        provider: String(job.provider),
        status: parseJobStatus(job.status),
        created_at: Number(job.created_at),
        claimed_at: Number(job.claimed_at),
        completed_at: Number(job.completed_at),
        result_hash: String(job.result_hash || ''),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function getConsumerJobs(consumer: string): Promise<number[]> {
  try {
    const args = [Address.fromString(consumer).toScVal()];
    const result = await readContract(CONTRACTS.jobMarketplace, 'get_consumer_jobs', args);
    if (result) {
      return scValToNative(result) as number[];
    }
  } catch {
    return [];
  }
  return [];
}

export async function getProviderJobs(provider: string): Promise<number[]> {
  try {
    const args = [Address.fromString(provider).toScVal()];
    const result = await readContract(CONTRACTS.jobMarketplace, 'get_provider_jobs', args);
    if (result) {
      return scValToNative(result) as number[];
    }
  } catch {
    return [];
  }
  return [];
}

export async function getNextJobId(): Promise<number> {
  try {
    const result = await readContract(CONTRACTS.jobMarketplace, 'get_next_job_id', []);
    if (result) {
      return scValToNative(result) as number;
    }
  } catch {
    return 0;
  }
  return 0;
}

export async function getOpenJobs(): Promise<Job[]> {
  const openJobs: Job[] = [];

  try {
    const nextId = await getNextJobId();

    // Fetch all jobs in parallel for better performance
    const jobPromises = [];
    for (let i = 0; i < nextId; i++) {
      jobPromises.push(getJob(i));
    }

    const jobs = await Promise.all(jobPromises);

    for (const job of jobs) {
      if (job && job.status === 0) {
        openJobs.push(job);
      }
    }
  } catch {
    return [];
  }

  return openJobs;
}
