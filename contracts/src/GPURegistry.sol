// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GPURegistry {
    struct GPU {
        address provider;
        string model;
        uint256 vramGB;
        uint256 pricePerHour;
        bool available;
        uint256 totalJobs;
        uint256 registeredAt;
    }

    mapping(uint256 => GPU) public gpus;
    mapping(address => uint256[]) public providerGPUs;
    uint256 public nextGPUId;

    event GPURegistered(uint256 indexed gpuId, address indexed provider, string model, uint256 pricePerHour);
    event GPUAvailabilityUpdated(uint256 indexed gpuId, bool available);
    event GPUPriceUpdated(uint256 indexed gpuId, uint256 newPrice);

    function registerGPU(string memory model, uint256 vramGB, uint256 pricePerHour) external returns (uint256) {
        require(bytes(model).length > 0, "Model cannot be empty");
        require(vramGB > 0, "VRAM must be greater than 0");
        require(pricePerHour > 0, "Price must be greater than 0");

        uint256 gpuId = nextGPUId++;

        gpus[gpuId] = GPU({
            provider: msg.sender,
            model: model,
            vramGB: vramGB,
            pricePerHour: pricePerHour,
            available: true,
            totalJobs: 0,
            registeredAt: block.timestamp
        });

        providerGPUs[msg.sender].push(gpuId);

        emit GPURegistered(gpuId, msg.sender, model, pricePerHour);
        return gpuId;
    }

    function setAvailability(uint256 gpuId, bool available) external {
        require(gpus[gpuId].provider == msg.sender, "Not GPU owner");
        gpus[gpuId].available = available;
        emit GPUAvailabilityUpdated(gpuId, available);
    }

    function updatePrice(uint256 gpuId, uint256 newPrice) external {
        require(gpus[gpuId].provider == msg.sender, "Not GPU owner");
        require(newPrice > 0, "Price must be greater than 0");
        gpus[gpuId].pricePerHour = newPrice;
        emit GPUPriceUpdated(gpuId, newPrice);
    }

    function incrementJobCount(uint256 gpuId) external {
        gpus[gpuId].totalJobs++;
    }

    function getGPU(uint256 gpuId) external view returns (GPU memory) {
        return gpus[gpuId];
    }

    function getProviderGPUs(address provider) external view returns (uint256[] memory) {
        return providerGPUs[provider];
    }

    function getAllGPUs() external view returns (uint256[] memory) {
        uint256[] memory allGpuIds = new uint256[](nextGPUId);
        for (uint256 i = 0; i < nextGPUId; i++) {
            allGpuIds[i] = i;
        }
        return allGpuIds;
    }

    function getAvailableGPUs() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nextGPUId; i++) {
            if (gpus[i].available) count++;
        }

        uint256[] memory availableIds = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < nextGPUId; i++) {
            if (gpus[i].available) {
                availableIds[index++] = i;
            }
        }
        return availableIds;
    }
}
