import { useState, useEffect } from "react";
import { JobStatus, getJobStatusName, stroopsToXLM, xlmToStroops } from "../config/contracts";
import type { GPU, Job } from "../types";
import {
  getGPU,
  getNextGPUId,
  postJob,
  cancelJob,
  getJob,
  getConsumerJobs,
} from "../utils/stellar";
import { getIPFSGatewayUrl } from "../utils/ipfs";

interface Props {
  address: string;
}

// Component to display IPFS result with image preview
function ResultDisplay({ resultHash }: { resultHash: string }) {
  const [isImage, setIsImage] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);

  const resultUrl = resultHash.startsWith('ipfs://')
    ? getIPFSGatewayUrl(resultHash.replace('ipfs://', ''))
    : resultHash.startsWith('http')
    ? resultHash
    : null;

  // Check if IPFS result contains an image
  useEffect(() => {
    if (resultUrl) {
      // Try to load as image
      const img = new Image();
      img.onload = () => {
        setIsImage(true);
        setImageLoaded(true);
      };
      img.onerror = () => {
        setIsImage(false);
      };
      img.src = resultUrl;
    }
  }, [resultUrl]);

  if (!resultHash) return null;

  return (
    <div className="mt-3 p-3 bg-orange-50 rounded-none border border-orange-300">
      <div className="text-xs text-gray-400 mb-1">Result:</div>
      <div className="font-mono text-xs text-orange-600 break-all mb-2">{resultHash}</div>

      {/* Image Preview */}
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

      {/* View Button */}
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

export default function ConsumerDashboard({ address }: Props) {
  const [availableGPUs, setAvailableGPUs] = useState<(GPU & { id: number })[]>([]);
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [notifications, setNotifications] = useState<string[]>([]);

  // Selected GPU for job posting
  const [selectedGpuId, setSelectedGpuId] = useState<number | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [computeHours, setComputeHours] = useState("");

  // Job type and code/image fields
  const [jobType, setJobType] = useState<"simple" | "python-script" | "docker-image">("simple");
  const [pythonCode, setPythonCode] = useState("");
  const [dockerImage, setDockerImage] = useState("");

  // Search and filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [minVram, setMinVram] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState<"price" | "vram" | "jobs">("price");

  const selectedGpu = availableGPUs.find(g => g.id === selectedGpuId);
  const calculatedPayment = selectedGpu && computeHours
    ? (parseFloat(selectedGpu.pricePerHour) * parseFloat(computeHours)).toFixed(4)
    : "0";

  const filteredGPUs = availableGPUs
    .filter(gpu => {
      const matchesSearch = gpu.model.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesVram = !minVram || gpu.vramGB >= parseInt(minVram);
      const matchesPrice = !maxPrice || parseFloat(gpu.pricePerHour) <= parseFloat(maxPrice);
      return matchesSearch && matchesVram && matchesPrice;
    })
    .sort((a, b) => {
      if (sortBy === "price") return parseFloat(a.pricePerHour) - parseFloat(b.pricePerHour);
      if (sortBy === "vram") return b.vramGB - a.vramGB;
      if (sortBy === "jobs") return b.totalJobs - a.totalJobs;
      return 0;
    });

  const addNotification = (message: string) => {
    setNotifications((prev) => [message, ...prev].slice(0, 5));
    setTimeout(() => {
      setNotifications((prev) => prev.slice(0, -1));
    }, 10000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      // Load available GPUs by iterating through all GPU IDs
      const nextId = await getNextGPUId();
      const gpuData: (GPU & { id: number })[] = [];

      for (let i = 0; i < nextId; i++) {
        const gpu = await getGPU(i);
        if (gpu && gpu.available) {
          gpuData.push({
            id: i,
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
      setAvailableGPUs(gpuData);

      // Load my jobs
      const jobIds = await getConsumerJobs(address);
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
      setMyJobs(jobData);
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

  const handlePostJob = async () => {
    if (selectedGpuId === null || !computeHours || calculatedPayment === "0") return;

    let fullDescription = jobDescription;

    if (jobType === "python-script") {
      if (!pythonCode.trim()) {
        alert("Please enter Python code");
        return;
      }
      fullDescription = JSON.stringify({
        type: "python-script",
        description: jobDescription,
        code: pythonCode
      });
    } else if (jobType === "docker-image") {
      if (!dockerImage.trim()) {
        alert("Please enter Docker image URL");
        return;
      }
      fullDescription = JSON.stringify({
        type: "docker-image",
        description: jobDescription,
        image: dockerImage
      });
    } else {
      if (!jobDescription.trim()) {
        alert("Please enter job description");
        return;
      }
      fullDescription = JSON.stringify({
        type: "simple",
        description: jobDescription
      });
    }

    setTxPending(true);
    try {
      const paymentInStroops = xlmToStroops(calculatedPayment);
      await postJob(address, selectedGpuId, fullDescription, parseInt(computeHours), paymentInStroops);

      addNotification(`Job posted successfully! Payment ${calculatedPayment} XLM locked in escrow.`);
      setSelectedGpuId(null);
      setJobDescription("");
      setComputeHours("");
      setPythonCode("");
      setDockerImage("");
      setJobType("simple");
      await loadData();
    } catch (error: any) {
      console.error("Failed to post job:", error);

      let errorMsg = "Failed to post job";
      if (error.message?.includes("insufficient")) {
        errorMsg = `Insufficient XLM balance!\n\nGet free XLM from:\nhttps://laboratory.stellar.org/#account-creator?network=test`;
      } else {
        errorMsg = `Failed to post job: ${error.message}`;
      }
      alert(errorMsg);
    } finally {
      setTxPending(false);
    }
  };

  const handleCancelJob = async (jobId: number) => {
    if (!confirm("Cancel this job? Payment will be refunded.")) return;

    setTxPending(true);
    try {
      await cancelJob(address, jobId);
      addNotification(`Job #${jobId} cancelled. Payment refunded.`);
      await loadData();
    } catch (error: any) {
      console.error("Failed to cancel job:", error);
      alert(`Failed to cancel job: ${error.message}`);
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
        <h2 className="text-3xl font-bold text-orange-500">Consumer Dashboard</h2>
      </div>

      {/* Available GPUs */}
      <div>
        <h3 className="text-2xl font-semibold mb-4 text-gray-800">Available GPUs</h3>

        {availableGPUs.length > 0 && (
          <div className="mb-4 bg-white p-4 rounded-none border-2 border-orange-500 shadow-md">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <input
                type="text"
                placeholder="Search GPU model..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 text-sm focus:border-orange-500 focus:outline-none"
              />
              <input
                type="number"
                placeholder="Min VRAM (GB)"
                value={minVram}
                onChange={(e) => setMinVram(e.target.value)}
                className="bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 text-sm focus:border-orange-500 focus:outline-none"
              />
              <input
                type="text"
                placeholder="Max Price (XLM)"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 text-sm focus:border-orange-500 focus:outline-none"
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "price" | "vram" | "jobs")}
                className="bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 text-sm focus:border-orange-500 focus:outline-none"
              >
                <option value="price">Sort by Price</option>
                <option value="vram">Sort by VRAM</option>
                <option value="jobs">Sort by Experience</option>
              </select>
              <button
                onClick={() => { setSearchTerm(""); setMinVram(""); setMaxPrice(""); setSortBy("price"); }}
                className="bg-gray-100 hover:bg-gray-200 text-orange-500 px-4 py-2 rounded-none text-sm border-2 border-orange-500"
              >
                Clear Filters
              </button>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Showing {filteredGPUs.length} of {availableGPUs.length} GPUs
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : availableGPUs.length === 0 ? (
          <div className="text-gray-500">No GPUs available at the moment</div>
        ) : filteredGPUs.length === 0 ? (
          <div className="text-gray-500">No GPUs match your filters</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGPUs.map((gpu) => (
              <div
                key={gpu.id}
                className={`bg-white p-4 rounded-none border-2 cursor-pointer transition-all shadow-md ${
                  selectedGpuId === gpu.id
                    ? "border-orange-500 shadow-lg"
                    : "border-transparent hover:border-orange-300"
                }`}
                onClick={() => setSelectedGpuId(gpu.id)}
              >
                <div className="flex justify-between items-start mb-2">
                  <h4 className="text-lg font-semibold text-orange-500">{gpu.model}</h4>
                  <span className="px-2 py-1 rounded-none text-xs bg-orange-500 text-white">Available</span>
                </div>
                <div className="text-sm space-y-1 text-gray-600">
                  <div>VRAM: {gpu.vramGB} GB</div>
                  <div>Price: {gpu.pricePerHour} XLM/hour</div>
                  <div>Total Jobs: {gpu.totalJobs}</div>
                  <div className="text-xs text-gray-400">
                    Provider: {gpu.provider.slice(0, 10)}...
                  </div>
                </div>
                {selectedGpuId === gpu.id && (
                  <div className="mt-2 text-sm text-orange-500 font-semibold">Selected</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Post Job Form */}
      {selectedGpuId !== null && (
        <div className="bg-white p-6 rounded-none border-2 border-orange-500 shadow-lg">
          <h3 className="text-xl font-semibold mb-4 text-orange-500">Post New Job (GPU #{selectedGpuId})</h3>

          <div className="space-y-4">
            {/* Job Type Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Job Type</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setJobType("simple")}
                  className={`px-4 py-3 rounded-none border-2 transition-all ${
                    jobType === "simple"
                      ? "border-orange-500 bg-orange-50 text-orange-600"
                      : "border-gray-300 hover:border-orange-300 text-gray-500"
                  }`}
                >
                  <div className="font-semibold">Simple</div>
                  <div className="text-xs">Just description</div>
                </button>
                <button
                  onClick={() => setJobType("python-script")}
                  className={`px-4 py-3 rounded-none border-2 transition-all ${
                    jobType === "python-script"
                      ? "border-orange-500 bg-orange-50 text-orange-600"
                      : "border-gray-300 hover:border-orange-300 text-gray-500"
                  }`}
                >
                  <div className="font-semibold">Python Script</div>
                  <div className="text-xs">Submit code</div>
                </button>
                <button
                  onClick={() => setJobType("docker-image")}
                  className={`px-4 py-3 rounded-none border-2 transition-all ${
                    jobType === "docker-image"
                      ? "border-orange-500 bg-orange-50 text-orange-600"
                      : "border-gray-300 hover:border-orange-300 text-gray-500"
                  }`}
                >
                  <div className="font-semibold">Docker Image</div>
                  <div className="text-xs">From Docker Hub</div>
                </button>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <input
                type="text"
                placeholder="Brief description of your job"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                className="w-full bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 focus:border-orange-500 focus:outline-none"
              />
            </div>

            {/* Python Code Input */}
            {jobType === "python-script" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Python Code
                  <span className="text-xs text-gray-400 ml-2">(Provider will run this on their GPU)</span>
                </label>
                <textarea
                  value={pythonCode}
                  onChange={(e) => setPythonCode(e.target.value)}
                  placeholder={`import torch\nx = torch.randn(1000, 1000).cuda()\nresult = torch.matmul(x, x).sum().item()\nprint(f"RESULT:{result}")`}
                  className="w-full h-64 bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 font-mono text-sm focus:border-orange-500 focus:outline-none"
                />
              </div>
            )}

            {/* Docker Image Input */}
            {jobType === "docker-image" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Docker Image Name
                </label>
                <input
                  type="text"
                  value={dockerImage}
                  onChange={(e) => setDockerImage(e.target.value)}
                  placeholder="username/image-name"
                  className="w-full bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 font-mono focus:border-orange-500 focus:outline-none"
                />
              </div>
            )}

            {/* Compute Hours */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Compute Hours</label>
              <input
                type="number"
                placeholder="How many hours of GPU time needed"
                value={computeHours}
                onChange={(e) => setComputeHours(e.target.value)}
                className="w-full bg-gray-50 border-2 border-gray-300 rounded-none px-4 py-2 focus:border-orange-500 focus:outline-none"
              />
            </div>

            {/* Payment Display */}
            {selectedGpu && (
              <div className="p-4 bg-gray-50 rounded-none border-2 border-orange-400">
                <div className="text-sm text-gray-500 mb-2">Payment Calculation</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-gray-400">GPU Hourly Rate</div>
                    <div className="text-gray-800 font-semibold">{selectedGpu.pricePerHour} XLM/hour</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Compute Hours</div>
                    <div className="text-gray-800 font-semibold">{computeHours || "0"}h</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Provider Earns (95%)</div>
                    <div className="text-orange-500 font-semibold">{(parseFloat(calculatedPayment) * 0.95).toFixed(4)} XLM</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">Platform Fee (5%)</div>
                    <div className="text-gray-500 text-sm">{(parseFloat(calculatedPayment) * 0.05).toFixed(4)} XLM</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-300">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Total Payment:</span>
                    <span className="text-2xl font-bold text-orange-500">{calculatedPayment} XLM</span>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handlePostJob}
              disabled={txPending || !computeHours || calculatedPayment === "0"}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-none font-medium disabled:opacity-50 text-lg"
            >
              {txPending ? "Processing..." : `Post Job & Pay ${calculatedPayment} XLM`}
            </button>
          </div>
        </div>
      )}

      {/* Current Jobs */}
      <div>
        <h3 className="text-2xl font-semibold mb-4 text-orange-500">Current Jobs</h3>
        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : myJobs.filter(j => j.status !== JobStatus.Completed && j.status !== JobStatus.Cancelled).length === 0 ? (
          <div className="text-gray-500">No active jobs</div>
        ) : (
          <div className="space-y-4">
            {myJobs.filter(j => j.status !== JobStatus.Completed && j.status !== JobStatus.Cancelled).map((job) => {
              const jobData = parseJobData(job.description);
              const providerEarnings = (parseFloat(job.paymentAmount) * 0.95).toFixed(4);

              return (
                <div key={job.jobId} className="bg-white p-6 rounded-none border-2 border-orange-200 hover:border-orange-500 shadow-md">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-xl font-semibold text-orange-500">Job #{job.jobId}</h4>
                        <span className="px-3 py-1 rounded-none text-xs bg-gray-100 text-gray-600 border border-gray-300">
                          {jobData.type || "simple"}
                        </span>
                        <span className={`px-3 py-1 rounded-none text-sm font-medium border ${
                          job.status === JobStatus.Open
                            ? "bg-orange-500 text-white border-orange-600"
                            : "bg-orange-500 text-white border-orange-600 animate-pulse"
                        }`}>
                          {getJobStatusName(job.status)}
                        </span>
                      </div>
                      <p className="text-gray-700 mb-3">{jobData.description || job.description}</p>

                      {jobData.type === "python-script" && jobData.code && (
                        <div className="mb-3 p-3 bg-gray-50 rounded-none border-2 border-gray-200">
                          <div className="text-xs text-gray-400 mb-1">Python Code:</div>
                          <pre className="text-xs text-orange-600 font-mono overflow-x-auto max-h-32">
                            {jobData.code.substring(0, 200)}
                            {jobData.code.length > 200 && "..."}
                          </pre>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4 mt-3 p-3 bg-gray-50 rounded-none border border-orange-200">
                        <div>
                          <div className="text-xs text-gray-400">Your Payment</div>
                          <div className="text-lg font-semibold text-gray-800">{job.paymentAmount} XLM</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-400">Provider Gets (95%)</div>
                          <div className="text-lg font-semibold text-orange-500">{providerEarnings} XLM</div>
                        </div>
                      </div>

                      {job.resultHash && <ResultDisplay resultHash={job.resultHash} />}
                    </div>

                    <div className="ml-4">
                      {job.status === JobStatus.Open && (
                        <button
                          onClick={() => handleCancelJob(job.jobId)}
                          disabled={txPending}
                          className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-none font-medium disabled:opacity-50"
                        >
                          Cancel Job<br/>
                          <span className="text-xs">Get refund</span>
                        </button>
                      )}
                      {job.status === JobStatus.Claimed && (
                        <div className="text-center p-3 bg-orange-50 rounded-none border-2 border-orange-400">
                          <div className="text-orange-500 font-semibold">In Progress</div>
                          <div className="text-xs text-gray-500 mt-1">Provider working</div>
                        </div>
                      )}
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
        ) : myJobs.filter(j => j.status === JobStatus.Completed).length === 0 ? (
          <div className="text-gray-500">No completed jobs yet</div>
        ) : (
          <div className="space-y-4">
            {myJobs.filter(j => j.status === JobStatus.Completed).map((job) => {
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
                      <div className="text-orange-500 font-semibold">Completed</div>
                      <div className="text-sm text-gray-500">{job.paymentAmount} XLM</div>
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
