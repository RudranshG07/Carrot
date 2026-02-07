import { useState, useEffect } from "react";
import { JobStatus, getJobStatusName, stroopsToXLM, xlmToStroops } from "../config/contracts";
import type { GPU, Job } from "../types";
import {
  registerGPU,
  setGPUAvailability,
  getGPU,
  getProviderGPUs,
  claimJob,
  completeJob,
  getJob,
  getProviderJobs,
  getOpenJobs,
} from "../utils/stellar";
import { uploadJobResult, getIPFSGatewayUrl } from "../utils/ipfs";

interface Props {
  address: string;
}

// Component to display result with image preview
function ResultDisplay({ resultHash }: { resultHash: string }) {
  const [isImage, setIsImage] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);

  const resultUrl = resultHash.startsWith('ipfs://')
    ? getIPFSGatewayUrl(resultHash.replace('ipfs://', ''))
    : resultHash.startsWith('http')
    ? resultHash
    : null;

  useEffect(() => {
    if (resultUrl) {
      const img = new Image();
      img.onload = () => {
        setIsImage(true);
        setImageLoaded(true);
      };
      img.onerror = () => setIsImage(false);
      img.src = resultUrl;
    }
  }, [resultUrl]);

  if (!resultHash) return null;

  return (
    <div className="mt-3 p-3 bg-orange-50 rounded-none border border-orange-300">
      <div className="text-xs text-gray-400 mb-1">Result:</div>
      <div className="font-mono text-xs text-orange-600 break-all mb-2">{resultHash}</div>

      {isImage && imageLoaded && resultUrl && (
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-2">Image Preview:</div>
          <img
            src={resultUrl}
            alt="Job Result"
            className={`border-2 border-orange-300 cursor-pointer transition-all ${
              showFullImage ? 'max-w-full' : 'max-w-xs max-h-48 object-cover'
            }`}
            onClick={() => setShowFullImage(!showFullImage)}
          />
          <div className="text-xs text-gray-400 mt-1">
            {showFullImage ? 'Click to minimize' : 'Click to expand'}
          </div>
        </div>
      )}

      {resultUrl && (
        <a
          href={resultUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-none text-sm font-medium"
        >
          {isImage ? 'Open Full Image' : 'View Result'}
        </a>
      )}
    </div>
  );
}

export default function ProviderDashboard({ address }: Props) {
  const [gpus, setGpus] = useState<(GPU & { id: number })[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [openJobs, setOpenJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [notifications, setNotifications] = useState<string[]>([]);

  // Form state
  const [gpuModel, setGpuModel] = useState("");
  const [vram, setVram] = useState("");
  const [price, setPrice] = useState("");

  // GPU Worker state
  const [processingJobId, setProcessingJobId] = useState<number | null>(null);
  const [executionLogs, setExecutionLogs] = useState<{[key: number]: string}>({});
  const [executionResults, setExecutionResults] = useState<{[key: number]: string}>({});

  // IPFS upload state
  const [uploadingToIPFS, setUploadingToIPFS] = useState<{[key: number]: boolean}>({});
  const [ipfsHashes, setIpfsHashes] = useState<{[key: number]: string}>({});

  const addNotification = (message: string) => {
    setNotifications((prev) => [message, ...prev].slice(0, 5));
    setTimeout(() => {
      setNotifications((prev) => prev.slice(0, -1));
    }, 10000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // Load provider's GPUs
      const gpuIds = await getProviderGPUs(address);
      const gpuData: (GPU & { id: number })[] = [];

      for (const id of gpuIds) {
        const gpu = await getGPU(id);
        if (gpu && gpu.available) {
          gpuData.push({
            id,
            provider: gpu.provider,
            model: gpu.model,
            vramGB: gpu.vram_gb,
            pricePerHour: stroopsToXLM(gpu.price_per_hour),
            available: gpu.available,
            totalJobs: gpu.total_jobs,
            registeredAt: gpu.registered_at,
          });
        }
      }
      setGpus(gpuData);

      // Load provider's jobs
      const jobIds = await getProviderJobs(address);
      const jobData: Job[] = [];

      for (const id of jobIds) {
        const job = await getJob(id);
        if (job) {
          jobData.push({
            jobId: job.job_id,
            consumer: job.consumer,
            gpuId: job.gpu_id,
            description: job.description,
            computeHours: job.compute_hours,
            paymentAmount: stroopsToXLM(job.payment_amount),
            provider: job.provider,
            status: job.status,
            createdAt: job.created_at,
            claimedAt: job.claimed_at,
            completedAt: job.completed_at,
            resultHash: job.result_hash,
          });
        }
      }
      setJobs(jobData);

      // Load open jobs that can be claimed
      const openJobsData = await getOpenJobs();
      const formattedOpenJobs: Job[] = openJobsData.map((job) => ({
        jobId: job.job_id,
        consumer: job.consumer,
        gpuId: job.gpu_id,
        description: job.description,
        computeHours: job.compute_hours,
        paymentAmount: stroopsToXLM(job.payment_amount),
        provider: job.provider,
        status: job.status,
        createdAt: job.created_at,
        claimedAt: job.claimed_at,
        completedAt: job.completed_at,
        resultHash: job.result_hash,
      }));
      setOpenJobs(formattedOpenJobs);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Refresh every 30 seconds instead of 15 to reduce lag
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [address]);

  const handleRegisterGPU = async () => {
    if (!gpuModel || !vram || !price) return;

    setTxPending(true);
    try {
      const priceInStroops = xlmToStroops(price);
      await registerGPU(address, gpuModel, parseInt(vram), priceInStroops);

      addNotification(`GPU "${gpuModel}" registered successfully!`);
      setGpuModel("");
      setVram("");
      setPrice("");
      await loadData();
    } catch (error: any) {
      console.error("Failed to register GPU:", error);
      alert(`Failed to register GPU: ${error.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const toggleAvailability = async (gpuId: number, currentStatus: boolean) => {
    setTxPending(true);
    try {
      await setGPUAvailability(address, gpuId, !currentStatus);
      await loadData();
    } catch (error: any) {
      console.error("Failed to toggle availability:", error);
      alert(`Failed to toggle availability: ${error.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleClaimJob = async (jobId: number) => {
    setTxPending(true);
    try {
      await claimJob(address, jobId);
      addNotification(`Successfully claimed Job #${jobId}!`);
      await loadData();
    } catch (error: any) {
      console.error("Failed to claim job:", error);
      alert(`Failed to claim job: ${error.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const parseJobData = (description: string) => {
    try {
      return JSON.parse(description);
    } catch {
      return { type: "simple", description };
    }
  };

  const runJobWithGPU = async (job: Job) => {
    const jobData = parseJobData(job.description);
    setProcessingJobId(job.jobId);
    setExecutionLogs(prev => ({...prev, [job.jobId]: "Starting GPU worker...\n"}));

    try {
      const healthCheck = await fetch('http://localhost:3001/health').catch(() => null);
      if (!healthCheck) {
        throw new Error("GPU Worker not running. Start it with: cd provider-worker && npm start");
      }

      setExecutionLogs(prev => ({...prev, [job.jobId]: prev[job.jobId] + "Calling GPU worker...\n"}));

      const response = await fetch('http://localhost:3001/process-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.jobId,
          jobType: jobData.type || 'simple',
          jobData: jobData.type === 'python-script'
            ? { code: jobData.code }
            : jobData.type === 'docker-image'
            ? { image: jobData.image }
            : { description: jobData.description }
        })
      });

      const result = await response.json();

      if (result.success) {
        const resultHash = result.resultHash || result.result;

        setExecutionLogs(prev => ({
          ...prev,
          [job.jobId]: prev[job.jobId] + "\n=== EXECUTION LOGS ===\n" + result.logs + "\n=== COMPLETE ===\n"
        }));
        setExecutionResults(prev => ({...prev, [job.jobId]: resultHash}));

        // If GPU worker already uploaded to IPFS (image), set it directly
        if (resultHash && resultHash.startsWith('ipfs://')) {
          setIpfsHashes(prev => ({...prev, [job.jobId]: resultHash}));
          addNotification(`Job #${job.jobId} processed! Image uploaded to IPFS.`);
        } else {
          addNotification(`Job #${job.jobId} processed successfully!`);
        }
      } else {
        throw new Error(result.error || "GPU processing failed");
      }
    } catch (error: any) {
      console.error("GPU Worker error:", error);
      setExecutionLogs(prev => ({
        ...prev,
        [job.jobId]: prev[job.jobId] + `\nERROR: ${error.message}\n`
      }));
      alert(`GPU Worker Error: ${error.message}`);
    } finally {
      setProcessingJobId(null);
    }
  };

  const uploadResultToIPFS = async (jobId: number) => {
    const result = executionResults[jobId] || "";

    // If already an IPFS hash (GPU worker uploaded image), just use it
    if (result.startsWith('ipfs://')) {
      setIpfsHashes(prev => ({...prev, [jobId]: result}));
      addNotification(`Image already on IPFS!`);
      return;
    }

    const logs = executionLogs[jobId] || "No execution logs";

    setUploadingToIPFS(prev => ({...prev, [jobId]: true}));

    try {
      const uploadResult = await uploadJobResult(jobId, logs, result);

      if (uploadResult.success && uploadResult.ipfsUrl) {
        setIpfsHashes(prev => ({...prev, [jobId]: uploadResult.ipfsUrl!}));
        setExecutionResults(prev => ({...prev, [jobId]: uploadResult.ipfsUrl!}));
        addNotification(`Job #${jobId} uploaded to IPFS!`);
      } else {
        throw new Error(uploadResult.error || "Upload failed");
      }
    } catch (error: any) {
      console.error("IPFS upload error:", error);
      alert(`Failed to upload to IPFS: ${error.message}`);
    } finally {
      setUploadingToIPFS(prev => ({...prev, [jobId]: false}));
    }
  };

  const handleCompleteJob = async (jobId: number) => {
    let resultHash: string | null = ipfsHashes[jobId] || executionResults[jobId];

    if (!resultHash) {
      resultHash = prompt("Enter result hash (IPFS or proof of work):");
    }

    if (!resultHash) return;

    setTxPending(true);
    try {
      await completeJob(address, jobId, resultHash);
      addNotification(`Job #${jobId} completed! Payment received.`);

      setExecutionLogs(prev => { const n = {...prev}; delete n[jobId]; return n; });
      setExecutionResults(prev => { const n = {...prev}; delete n[jobId]; return n; });
      setIpfsHashes(prev => { const n = {...prev}; delete n[jobId]; return n; });

      await loadData();
    } catch (error: any) {
      console.error("Failed to complete job:", error);
      alert(`Failed to complete job: ${error.message}`);
    } finally {
      setTxPending(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="fixed top-20 right-4 space-y-2 z-50 max-w-md">
          {notifications.map((notif, idx) => (
            <div key={idx} className="bg-orange-500 text-white px-6 py-3 rounded-none shadow-lg border-2 border-orange-600">
              {notif}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center space-x-4 mb-8">
        <img src="/logo.png" alt="Carrot Logo" className="h-16 w-16 object-contain" />
        <h2 className="text-3xl font-bold text-orange-500">Provider Dashboard</h2>
      </div>

      {/* Statistics */}
      {!loading && gpus.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-none border-2 border-orange-500 shadow-md">
            <div className="text-xs text-gray-500 mb-1">Total GPUs</div>
            <div className="text-2xl font-bold text-orange-500">{gpus.length}</div>
          </div>
          <div className="bg-white p-4 rounded-none border-2 border-orange-500 shadow-md">
            <div className="text-xs text-gray-500 mb-1">Total Jobs</div>
            <div className="text-2xl font-bold text-orange-500">
              {gpus.reduce((sum, gpu) => sum + gpu.totalJobs, 0)}
            </div>
          </div>
          <div className="bg-white p-4 rounded-none border-2 border-orange-500 shadow-md">
            <div className="text-xs text-gray-500 mb-1">Total Earned</div>
            <div className="text-2xl font-bold text-orange-500">
              {jobs
                .filter(j => j.status === JobStatus.Completed)
                .reduce((sum, job) => sum + parseFloat(job.paymentAmount) * 0.95, 0)
                .toFixed(4)} XLM
            </div>
          </div>
          <div className="bg-white p-4 rounded-none border-2 border-orange-500 shadow-md">
            <div className="text-xs text-gray-500 mb-1">Active Jobs</div>
            <div className="text-2xl font-bold text-orange-500">
              {jobs.filter(j => j.status === JobStatus.Claimed).length}
            </div>
          </div>
        </div>
      )}

      {/* Register GPU Form */}
      <div className="bg-white p-6 rounded-none shadow-md border border-gray-200">
        <h3 className="text-xl font-semibold mb-4 text-orange-500">Register New GPU</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <input
            type="text"
            placeholder="GPU Model (e.g., RTX 4090)"
            value={gpuModel}
            onChange={(e) => setGpuModel(e.target.value)}
            className="bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 focus:border-orange-500 focus:outline-none"
          />
          <input
            type="number"
            placeholder="VRAM (GB)"
            value={vram}
            onChange={(e) => setVram(e.target.value)}
            className="bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 focus:border-orange-500 focus:outline-none"
          />
          <input
            type="text"
            placeholder="Price per Hour (XLM)"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 focus:border-orange-500 focus:outline-none"
          />
          <button
            onClick={handleRegisterGPU}
            disabled={txPending || !gpuModel || !vram || !price}
            className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-none font-medium disabled:opacity-50"
          >
            {txPending ? "Processing..." : "Register GPU"}
          </button>
        </div>
      </div>

      {/* My GPUs */}
      <div>
        <h3 className="text-2xl font-semibold mb-4 text-orange-500">My GPUs</h3>
        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : gpus.length === 0 ? (
          <div className="text-gray-500">No GPUs registered yet</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {gpus.map((gpu) => (
              <div key={gpu.id} className="bg-white p-4 rounded-none border-2 border-transparent hover:border-orange-500 transition-all shadow-md">
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-lg font-semibold text-orange-500">{gpu.model}</h4>
                  <span className={`px-2 py-1 rounded-none text-xs border ${gpu.available ? "bg-orange-500 text-white border-orange-600" : "bg-gray-200 text-gray-600 border-gray-300"}`}>
                    {gpu.available ? "Available" : "Unavailable"}
                  </span>
                </div>
                <div className="text-sm space-y-1 text-gray-600">
                  <div>VRAM: {gpu.vramGB} GB</div>
                  <div>Price: {gpu.pricePerHour} XLM/hour</div>
                  <div>Total Jobs: {gpu.totalJobs}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    onClick={() => toggleAvailability(gpu.id, gpu.available)}
                    disabled={txPending}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-none text-sm disabled:opacity-50 border border-gray-300"
                  >
                    {gpu.available ? "Set Unavailable" : "Set Available"}
                  </button>
                  <button
                    onClick={() => toggleAvailability(gpu.id, true)}
                    disabled={txPending}
                    className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-none text-sm disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Available Jobs to Claim */}
      <div>
        <h3 className="text-2xl font-semibold mb-4 text-orange-500">Available Jobs to Claim</h3>
        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : openJobs.length === 0 ? (
          <div className="text-gray-500">No jobs available to claim</div>
        ) : (
          <div className="space-y-4">
            {openJobs.map((job) => {
              const yourEarnings = (parseFloat(job.paymentAmount) * 0.95).toFixed(4);
              const jobData = parseJobData(job.description);

              return (
                <div key={job.jobId} className="bg-white p-6 rounded-none border-2 border-orange-200 hover:border-orange-500 shadow-md">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-xl font-semibold text-orange-500">Job #{job.jobId}</h4>
                        <span className="px-3 py-1 rounded-none text-xs bg-gray-100 text-gray-600 border border-gray-300">
                          {jobData.type || "simple"}
                        </span>
                        <span className="px-3 py-1 rounded-none text-sm font-medium bg-orange-500 text-white">
                          Open
                        </span>
                      </div>
                      <p className="text-gray-700 mb-3">{jobData.description || job.description}</p>
                      <div className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded-none border border-orange-200">
                        <div>
                          <div className="text-xs text-gray-400">Total Payment</div>
                          <div className="text-lg font-semibold text-gray-800">{job.paymentAmount} XLM</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400">Your Earnings (95%)</div>
                          <div className="text-lg font-semibold text-orange-500">{yourEarnings} XLM</div>
                        </div>
                      </div>
                    </div>
                    <div className="ml-4">
                      <button
                        onClick={() => handleClaimJob(job.jobId)}
                        disabled={txPending}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-none font-medium disabled:opacity-50"
                      >
                        Claim Job<br/>
                        <span className="text-xs">Earn {yourEarnings} XLM</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Current Jobs */}
      <div>
        <h3 className="text-2xl font-semibold mb-4 text-orange-500">Current Jobs</h3>
        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : jobs.filter(j => j.status === JobStatus.Claimed).length === 0 ? (
          <div className="text-gray-500">No active jobs</div>
        ) : (
          <div className="space-y-4">
            {jobs.filter(j => j.status === JobStatus.Claimed).map((job) => {
              const yourEarnings = (parseFloat(job.paymentAmount) * 0.95).toFixed(4);
              const jobData = parseJobData(job.description);

              return (
                <div key={job.jobId} className="bg-white p-6 rounded-none border-2 border-gray-200 shadow-md">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-xl font-semibold text-orange-500">Job #{job.jobId}</h4>
                        <span className="px-3 py-1 rounded-none text-sm font-medium bg-orange-500 text-white animate-pulse">
                          {getJobStatusName(job.status)}
                        </span>
                      </div>
                      <p className="text-gray-700 mb-3">{jobData.description || job.description}</p>

                      {jobData.type === "python-script" && jobData.code && (
                        <div className="mb-3 p-3 bg-gray-50 rounded-none border-2 border-gray-200">
                          <div className="text-xs text-gray-500 mb-1">Python Code:</div>
                          <pre className="text-xs text-orange-600 font-mono overflow-x-auto max-h-32">
                            {jobData.code.substring(0, 200)}
                            {jobData.code.length > 200 && "..."}
                          </pre>
                        </div>
                      )}

                      {executionLogs[job.jobId] && (
                        <div className="mt-4 p-4 bg-gray-50 rounded-none border-2 border-orange-500">
                          <div className="text-sm text-gray-500 mb-2">Execution Logs:</div>
                          <pre className="text-xs text-orange-600 font-mono overflow-x-auto max-h-64 whitespace-pre-wrap">
                            {executionLogs[job.jobId]}
                          </pre>
                        </div>
                      )}

                      {ipfsHashes[job.jobId] && (
                        <ResultDisplay resultHash={ipfsHashes[job.jobId]} />
                      )}

                      <div className="grid grid-cols-2 gap-4 mt-3 p-3 bg-gray-50 rounded-none border border-orange-200">
                        <div>
                          <div className="text-xs text-gray-500">Total Payment</div>
                          <div className="text-lg font-semibold text-gray-800">{job.paymentAmount} XLM</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Your Earnings (95%)</div>
                          <div className="text-lg font-semibold text-orange-500">{yourEarnings} XLM</div>
                        </div>
                      </div>
                    </div>

                    <div className="ml-4 flex flex-col gap-2">
                      {(jobData.type === "python-script" || jobData.type === "docker-image") && (
                        <button
                          onClick={() => runJobWithGPU(job)}
                          disabled={processingJobId === job.jobId || txPending}
                          className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-none font-medium disabled:opacity-50"
                        >
                          {processingJobId === job.jobId ? "Processing..." : "Run with GPU"}
                        </button>
                      )}

                      {executionResults[job.jobId] && !ipfsHashes[job.jobId] && (
                        <button
                          onClick={() => uploadResultToIPFS(job.jobId)}
                          disabled={uploadingToIPFS[job.jobId] || txPending}
                          className="bg-orange-400 hover:bg-orange-500 text-white px-6 py-3 rounded-none font-medium disabled:opacity-50"
                        >
                          {uploadingToIPFS[job.jobId] ? "Uploading..." : "Upload to IPFS"}
                        </button>
                      )}

                      <button
                        onClick={() => handleCompleteJob(job.jobId)}
                        disabled={txPending}
                        className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-none font-medium disabled:opacity-50"
                      >
                        Complete Job<br/>
                        <span className="text-xs">Earn {yourEarnings} XLM</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Job History */}
      <div>
        <h3 className="text-2xl font-semibold mb-4 text-orange-500">Job History</h3>
        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : jobs.filter(j => j.status === JobStatus.Completed).length === 0 ? (
          <div className="text-gray-500">No completed jobs yet</div>
        ) : (
          <div className="space-y-4">
            {jobs.filter(j => j.status === JobStatus.Completed).map((job) => {
              const yourEarnings = (parseFloat(job.paymentAmount) * 0.95).toFixed(4);
              const jobData = parseJobData(job.description);

              return (
                <div key={job.jobId} className="bg-gray-50 p-6 rounded-none border-2 border-gray-200 shadow-sm">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-xl font-semibold text-gray-500">Job #{job.jobId}</h4>
                        <span className="px-3 py-1 rounded-none text-sm font-medium bg-orange-500 text-white">
                          Completed
                        </span>
                      </div>
                      <p className="text-gray-500">{jobData.description || job.description}</p>
                      {job.resultHash && <ResultDisplay resultHash={job.resultHash} />}
                    </div>
                    <div className="ml-4 text-center p-3 bg-orange-50 rounded-none border-2 border-orange-400">
                      <div className="text-orange-500 font-semibold">Paid!</div>
                      <div className="text-sm text-gray-500">{yourEarnings} XLM</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-16 pt-8 border-t border-gray-200 flex items-center justify-center space-x-3 opacity-50">
        <img src="/logo.png" alt="Carrot" className="h-8 w-8 object-contain" />
        <span className="text-sm text-gray-500">Powered by Carrot on Stellar</span>
      </div>
    </div>
  );
}
