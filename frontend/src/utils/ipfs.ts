import axios from 'axios';

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

export interface UploadResult {
  success: boolean;
  ipfsHash?: string;
  ipfsUrl?: string;
  error?: string;
}

/**
 * Upload text/JSON data to IPFS via Pinata
 */
export async function uploadToIPFS(data: string | object, filename?: string): Promise<UploadResult> {
  if (!PINATA_JWT) {
    return {
      success: false,
      error: 'Pinata JWT not configured. Add VITE_PINATA_JWT to .env file'
    };
  }

  try {
    // Prepare the data
    const jsonData = typeof data === 'string'
      ? { result: data, timestamp: Date.now() }
      : data;

    const payload = {
      pinataContent: jsonData,
      pinataMetadata: {
        name: filename || `job-result-${Date.now()}.json`,
      },
    };

    // Upload to Pinata
    const response = await axios.post(PINATA_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PINATA_JWT}`,
      },
    });

    const ipfsHash = response.data.IpfsHash;
    const ipfsUrl = `ipfs://${ipfsHash}`;

    return {
      success: true,
      ipfsHash,
      ipfsUrl,
    };
  } catch (error: any) {
    console.error('IPFS upload error:', error);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to upload to IPFS',
    };
  }
}

/**
 * Upload execution logs to IPFS
 */
export async function uploadJobResult(jobId: number, logs: string, result: string): Promise<UploadResult> {
  const resultData = {
    jobId,
    executionLogs: logs,
    result: result,
    timestamp: new Date().toISOString(),
    platform: 'Carrot GPU DePIN',
  };

  return uploadToIPFS(resultData, `job-${jobId}-result.json`);
}

/**
 * Get IPFS gateway URL for viewing
 */
export function getIPFSGatewayUrl(ipfsHash: string): string {
  // Remove ipfs:// prefix if present
  const hash = ipfsHash.replace('ipfs://', '');

  // Use multiple gateways for reliability
  return `https://gateway.pinata.cloud/ipfs/${hash}`;
  // Alternative gateways:
  // return `https://ipfs.io/ipfs/${hash}`;
  // return `https://cloudflare-ipfs.com/ipfs/${hash}`;
}
