const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// Create directories
const jobsDir = path.join(__dirname, 'jobs');
const resultsDir = path.join(__dirname, 'results');
if (!fs.existsSync(jobsDir)) fs.mkdirSync(jobsDir);
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir);

// IPFS Upload Functions
const PINATA_JWT = process.env.PINATA_JWT;
const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const PINATA_JSON_URL = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

async function uploadImageToIPFS(filePath, filename) {
  if (!PINATA_JWT) {
    console.error('[GPU Worker] Pinata JWT not configured');
    return null;
  }

  try {
    const FormData = require('form-data');
    const formData = new FormData();
    const fileStream = fs.createReadStream(filePath);

    formData.append('file', fileStream);
    formData.append('pinataMetadata', JSON.stringify({
      name: filename,
    }));

    const response = await axios.post(PINATA_API_URL, formData, {
      headers: {
        'Authorization': `Bearer ${PINATA_JWT}`,
        ...formData.getHeaders(),
      },
      maxBodyLength: Infinity,
    });

    const ipfsHash = response.data.IpfsHash;
    console.log(`[GPU Worker] Image uploaded to IPFS: ${ipfsHash}`);
    return ipfsHash;
  } catch (error) {
    console.error('[GPU Worker] IPFS image upload error:', error.message);
    return null;
  }
}

async function uploadMetadataToIPFS(metadata, filename) {
  if (!PINATA_JWT) {
    console.error('[GPU Worker] Pinata JWT not configured');
    return null;
  }

  try {
    const payload = {
      pinataContent: metadata,
      pinataMetadata: {
        name: filename,
      },
    };

    const response = await axios.post(PINATA_JSON_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PINATA_JWT}`,
      },
    });

    const ipfsHash = response.data.IpfsHash;
    console.log(`[GPU Worker] Metadata uploaded to IPFS: ${ipfsHash}`);
    return ipfsHash;
  } catch (error) {
    console.error('[GPU Worker] IPFS metadata upload error:', error.message);
    return null;
  }
}

// Process job submitted by consumer
app.post('/process-job', async (req, res) => {
  const { jobId, jobType, jobData } = req.body;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`[GPU Worker] Processing Job #${jobId}`);
  console.log(`[GPU Worker] Type: ${jobType}`);
  console.log(`${'='.repeat(50)}\n`);

  try {
    let result;

    if (jobType === 'python-script') {
      // Consumer submitted Python code
      result = await runPythonScript(jobId, jobData);
    } else if (jobType === 'docker-image') {
      // Consumer submitted Docker image URL
      result = await runDockerImage(jobId, jobData);
    } else {
      throw new Error(`Unknown job type: ${jobType}`);
    }

    console.log(`\n[GPU Worker] Job #${jobId} completed successfully!\n`);

    res.json({
      success: true,
      jobId: jobId,
      result: result.output,
      resultHash: result.hash,
      logs: result.logs
    });

  } catch (error) {
    console.error(`\n[GPU Worker] Job #${jobId} failed: ${error.message}\n`);

    res.status(500).json({
      success: false,
      error: error.message,
      logs: error.logs || ''
    });
  }
});

// Run consumer's Python script in Docker
async function runPythonScript(jobId, scriptData) {
  return new Promise((resolve, reject) => {
    // Save consumer's script to file
    const scriptPath = path.join(jobsDir, `job_${jobId}.py`);
    fs.writeFileSync(scriptPath, scriptData.code);

    console.log(`[GPU Worker] Saved consumer's Python script`);
    console.log(`[GPU Worker] Running in secure Docker container...\n`);

    // Run consumer's code in isolated Docker container with GPU (if available)
    const isMac = process.platform === 'darwin';
    const gpuFlag = isMac ? '' : '--gpus all';

    const dockerCmd = `docker run --rm ${gpuFlag} \
      -v ${scriptPath}:/job.py:ro \
      -v ${resultsDir}:/results \
      --memory="2g" \
      --cpus="2" \
      carrot-gpu-worker \
      python3 /job.py`.replace(/\s+/g, ' ');

    if (isMac) {
      console.log(`[GPU Worker] macOS detected - running without GPU flag (CPU mode)`);
    }

    exec(dockerCmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // Clean up script
      fs.unlinkSync(scriptPath);

      if (error) {
        reject({
          message: 'Script execution failed',
          logs: stderr || stdout
        });
        return;
      }

      // Read result if script wrote to file
      const resultFile = path.join(resultsDir, `job_${jobId}_output.txt`);
      let fileOutput = '';
      if (fs.existsSync(resultFile)) {
        fileOutput = fs.readFileSync(resultFile, 'utf8');
      }

      const output = fileOutput || stdout.trim();
      const hash = `0x${Buffer.from(output).toString('hex').slice(0, 16)}`;

      resolve({
        output: output,
        hash: hash,
        logs: stdout
      });
    });
  });
}

// Run consumer's Docker image
async function runDockerImage(jobId, imageData) {
  return new Promise((resolve, reject) => {
    let imageName = imageData.image;
    const imageArgs = imageData.args || '';

    // Strip Docker Hub URL if user pasted it by mistake
    if (imageName.includes('hub.docker.com')) {
      // Extract image name from URL like https://hub.docker.com/r/username/image
      const match = imageName.match(/hub\.docker\.com\/r\/([^\/]+\/[^\/\?]+)/);
      if (match) {
        imageName = match[1];
        console.log(`[GPU Worker] Detected URL, extracted image name: ${imageName}`);
      }
    }

    console.log(`[GPU Worker] Pulling consumer's Docker image: ${imageName}`);
    console.log(`[GPU Worker] Running with GPU access...\n`);

    // Pull image first
    exec(`docker pull ${imageName}`, (pullError, pullStdout, pullStderr) => {
      if (pullError) {
        reject({
          message: 'Failed to pull Docker image',
          logs: pullStderr
        });
        return;
      }

      console.log(`[GPU Worker] Image pulled successfully`);

      // Run consumer's container with GPU access (if available)
      // On macOS, skip --gpus flag since NVIDIA GPU not supported
      const isMac = process.platform === 'darwin';
      const gpuFlag = isMac ? '' : '--gpus all';

      // Create job-specific output directory
      const jobOutputDir = path.join(resultsDir, `job_${jobId}_output`);
      if (!fs.existsSync(jobOutputDir)) fs.mkdirSync(jobOutputDir, { recursive: true });

      const dockerCmd = `docker run --rm ${gpuFlag} \
        -v ${jobOutputDir}:/output \
        --memory="4g" \
        --cpus="4" \
        ${imageName} ${imageArgs}`.replace(/\s+/g, ' ');

      if (isMac) {
        console.log(`[GPU Worker] macOS detected - running without GPU flag (CPU mode)`);
      }

      console.log(`[GPU Worker] Running: ${dockerCmd}\n`);

      exec(dockerCmd, { maxBuffer: 10 * 1024 * 1024 }, async (error, stdout, stderr) => {
        if (error) {
          console.log(`[GPU Worker] Container output:\n${stdout}`);
          console.log(`[GPU Worker] Container errors:\n${stderr}`);
          reject({
            message: `Container execution failed: ${error.message}`,
            logs: `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`
          });
          return;
        }

        const output = stdout.trim();
        let hash = `0x${Buffer.from(output).toString('hex').slice(0, 16)}`;

        // Check for output files (images, etc.)
        const outputFiles = [];
        let imageIpfsHash = null;
        let metadataIpfsHash = null;

        if (fs.existsSync(jobOutputDir)) {
          const files = fs.readdirSync(jobOutputDir);
          for (const file of files) {
            const filePath = path.join(jobOutputDir, file);
            const stats = fs.statSync(filePath);

            // Upload image files to IPFS
            if (file.match(/\.(png|jpg|jpeg|gif|webp)$/i) && stats.size < 5 * 1024 * 1024) {
              console.log(`[GPU Worker] Found output file: ${file} (${stats.size} bytes)`);

              // Upload image to IPFS
              console.log(`[GPU Worker] Uploading image to IPFS...`);
              imageIpfsHash = await uploadImageToIPFS(filePath, `job-${jobId}-${file}`);

              if (imageIpfsHash) {
                // Create metadata JSON with image reference
                const metadata = {
                  jobId: jobId,
                  image: `ipfs://${imageIpfsHash}`,
                  imageFilename: file,
                  imageSize: stats.size,
                  executionLogs: stdout,
                  result: output,
                  timestamp: new Date().toISOString(),
                  platform: 'Carrot GPU DePIN'
                };

                // Upload metadata JSON to IPFS
                console.log(`[GPU Worker] Uploading metadata to IPFS...`);
                metadataIpfsHash = await uploadMetadataToIPFS(metadata, `job-${jobId}-metadata.json`);

                // Store IMAGE hash on blockchain (so users see the image directly)
                hash = `ipfs://${imageIpfsHash}`;
                console.log(`[GPU Worker] IPFS Upload Complete!`);
                console.log(`[GPU Worker] Image: ipfs://${imageIpfsHash}`);
                console.log(`[GPU Worker] Metadata: ipfs://${metadataIpfsHash}`);
              }

              // Also include base64 for backward compatibility
              const fileData = fs.readFileSync(filePath);
              outputFiles.push({
                filename: file,
                data: fileData.toString('base64'),
                type: file.split('.').pop().toLowerCase(),
                size: stats.size,
                ipfsHash: imageIpfsHash
              });
            }
          }
        }

        resolve({
          output: output,
          hash: hash,
          logs: stdout,
          files: outputFiles,
          ipfsImage: imageIpfsHash ? `ipfs://${imageIpfsHash}` : null,
          ipfsMetadata: metadataIpfsHash ? `ipfs://${metadataIpfsHash}` : null
        });
      });
    });
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    gpuAvailable: true,
    jobsProcessed: 0
  });
});

// Check Docker
app.get('/check-docker', (req, res) => {
  exec('docker --version', (error, stdout) => {
    if (error) {
      res.json({ dockerInstalled: false });
    } else {
      res.json({
        dockerInstalled: true,
        version: stdout.trim()
      });
    }
  });
});

// Check GPU access
app.get('/check-gpu', (req, res) => {
  exec('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', (error, stdout) => {
    if (error) {
      res.json({ gpuAvailable: false });
    } else {
      const [name, memory] = stdout.trim().split(',');
      res.json({
        gpuAvailable: true,
        name: name.trim(),
        memory: memory.trim()
      });
    }
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   Carrot GPU Worker Server                 ║');
  console.log('║   Consumer Code Execution Engine           ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\n Server: http://localhost:${PORT}`);
  console.log(' Security: Isolated containers, no network');
  console.log(' GPU: Ready for compute jobs');
  console.log('\n Waiting for consumer jobs...\n');
});
