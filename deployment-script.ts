import { ethers, upgrades } from "hardhat";
import { Contract, ContractFactory } from "ethers";
import fs from "fs";
import path from "path";

// Configuration
const config = {
  // Signature expiry duration (in seconds) - Default: 1 hour (3600 seconds)
  signatureExpiryDuration: 3600,
  // The address that will be used for verifying signatures
  verifierAddress: process.env.VERIFIER_ADDRESS,
  // Output file for deployed contract addresses
  outputFile: "deployed-addresses.json",
  // Network configuration (can be extended for multiple networks)
  networks: {
    mainnet: {
      name: "Ethereum Mainnet",
      chainId: 1
    },
    goerli: {
      name: "Goerli Testnet",
      chainId: 5
    },
    polygon: {
      name: "Polygon Mainnet",
      chainId: 137
    },
    mumbai: {
      name: "Mumbai Testnet",
      chainId: 80001
    }
  }
};

// Type definition for deployed contracts
interface DeployedContracts {
  network: string;
  chainId: number;
  contracts: {
    ProxyAdmin: string;
    AirdropRegistry: string;
    AirdropRegistryProxy: string;
    RewardDistributor: string;
    RewardDistributorProxy: string;
  };
  timestamp: string;
}

/**
 * Main deployment function
 */
async function main() {
  // Get deployer account
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);
  
  // Get network info
  const network = await ethers.provider.getNetwork();
  const networkConfig = getNetworkConfig(network.chainId);
  console.log(`Deploying to network: ${networkConfig.name} (chainId: ${networkConfig.chainId})`);
  
  // Validate configuration
  validateConfig();
  
  // Start deployment
  console.log("Starting deployment...");
  
  try {
    // 1. Deploy ProxyAdmin
    console.log("1. Deploying RewardDistributorProxyAdmin...");
    const ProxyAdminFactory = await ethers.getContractFactory("RewardDistributorProxyAdmin");
    const proxyAdmin = await ProxyAdminFactory.deploy();
    await proxyAdmin.deployed();
    console.log(`   ProxyAdmin deployed to: ${proxyAdmin.address}`);
    
    // 2. Deploy AirdropRegistry implementation
    console.log("2. Deploying AirdropRegistry implementation...");
    const AirdropRegistryFactory = await ethers.getContractFactory("AirdropRegistry");
    const airdropRegistryImpl = await AirdropRegistryFactory.deploy();
    await airdropRegistryImpl.deployed();
    console.log(`   AirdropRegistry implementation deployed to: ${airdropRegistryImpl.address}`);
    
    // 3. Deploy AirdropRegistryProxy
    console.log("3. Deploying AirdropRegistryProxy...");
    const initData = AirdropRegistryFactory.interface.encodeFunctionData("initialize");
    const AirdropRegistryProxyFactory = await ethers.getContractFactory("RewardDistributorProxy");
    const airdropRegistryProxy = await AirdropRegistryProxyFactory.deploy(
      airdropRegistryImpl.address,
      initData,
      proxyAdmin.address
    );
    await airdropRegistryProxy.deployed();
    console.log(`   AirdropRegistryProxy deployed to: ${airdropRegistryProxy.address}`);
    
    // Connect to AirdropRegistry through proxy for later verification
    const airdropRegistry = AirdropRegistryFactory.attach(airdropRegistryProxy.address);
    
    // 4. Deploy RewardDistributor implementation
    console.log("4. Deploying RewardDistributor implementation...");
    const RewardDistributorFactory = await ethers.getContractFactory("RewardDistributor");
    const rewardDistributorImpl = await RewardDistributorFactory.deploy();
    await rewardDistributorImpl.deployed();
    console.log(`   RewardDistributor implementation deployed to: ${rewardDistributorImpl.address}`);
    
    // 5. Deploy RewardDistributorProxy
    console.log("5. Deploying RewardDistributorProxy...");
    const rdInitData = RewardDistributorFactory.interface.encodeFunctionData(
      "initialize",
      [config.verifierAddress, config.signatureExpiryDuration]
    );
    const RewardDistributorProxyFactory = await ethers.getContractFactory("RewardDistributorProxy");
    const rewardDistributorProxy = await RewardDistributorProxyFactory.deploy(
      rewardDistributorImpl.address,
      rdInitData,
      proxyAdmin.address
    );
    await rewardDistributorProxy.deployed();
    console.log(`   RewardDistributorProxy deployed to: ${rewardDistributorProxy.address}`);
    
    // Connect to RewardDistributor through proxy
    const rewardDistributor = RewardDistributorFactory.attach(rewardDistributorProxy.address);
    
    // 6. Set AirdropRegistry address in RewardDistributor
    console.log("6. Setting AirdropRegistry address in RewardDistributor...");
    const setRegistryTx = await rewardDistributor.setAirdropRegistry(airdropRegistryProxy.address);
    await setRegistryTx.wait();
    console.log(`   AirdropRegistry address set in RewardDistributor`);
    
    // Verify deployment
    console.log("\nVerifying deployment...");
    
    // Check if initialized correctly
    const registryAddress = await rewardDistributor.airdropRegistry();
    console.log(`   AirdropRegistry address in RewardDistributor: ${registryAddress}`);
    if (registryAddress !== airdropRegistryProxy.address) {
      throw new Error("AirdropRegistry address mismatch");
    }
    
    const verifier = await rewardDistributor.verifier();
    console.log(`   Verifier address in RewardDistributor: ${verifier}`);
    if (verifier !== config.verifierAddress) {
      throw new Error("Verifier address mismatch");
    }
    
    const expiryDuration = await rewardDistributor.signatureExpiryDuration();
    console.log(`   Signature expiry duration in RewardDistributor: ${expiryDuration} seconds`);
    if (expiryDuration.toNumber() !== config.signatureExpiryDuration) {
      throw new Error("Signature expiry duration mismatch");
    }
    
    // Save deployed addresses
    const deployedContracts: DeployedContracts = {
      network: networkConfig.name,
      chainId: networkConfig.chainId,
      contracts: {
        ProxyAdmin: proxyAdmin.address,
        AirdropRegistry: airdropRegistryImpl.address,
        AirdropRegistryProxy: airdropRegistryProxy.address,
        RewardDistributor: rewardDistributorImpl.address,
        RewardDistributorProxy: rewardDistributorProxy.address
      },
      timestamp: new Date().toISOString()
    };
    
    saveDeployment(deployedContracts);
    
    console.log("\nDeployment completed successfully!");
    console.log(`Deployed contract addresses saved to ${config.outputFile}`);
    
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

/**
 * Get network configuration based on chain ID
 */
function getNetworkConfig(chainId: number) {
  for (const [name, network] of Object.entries(config.networks)) {
    if (network.chainId === chainId) {
      return { name, chainId };
    }
  }
  return { name: `Unknown Network (${chainId})`, chainId };
}

/**
 * Validate configuration parameters
 */
function validateConfig() {
  if (!config.verifierAddress) {
    throw new Error("VERIFIER_ADDRESS environment variable is not set");
  }
  
  if (config.signatureExpiryDuration <= 0) {
    throw new Error("signatureExpiryDuration must be greater than 0");
  }
}

/**
 * Save deployment information to file
 */
function saveDeployment(deployedContracts: DeployedContracts) {
  const outputPath = path.resolve(__dirname, "..", config.outputFile);
  
  let existingDeployments: DeployedContracts[] = [];
  
  // Read existing deployments if file exists
  if (fs.existsSync(outputPath)) {
    const fileContent = fs.readFileSync(outputPath, 'utf8');
    try {
      existingDeployments = JSON.parse(fileContent);
    } catch (error) {
      console.warn(`Warning: Could not parse existing ${config.outputFile}, creating new file`);
    }
  }
  
  // Add new deployment
  existingDeployments.push(deployedContracts);
  
  // Write to file
  fs.writeFileSync(outputPath, JSON.stringify(existingDeployments, null, 2));
}

/**
 * Extra deployment helper for specific network
 */
export async function deployToNetwork(networkName: string) {
  if (!Object.keys(config.networks).includes(networkName)) {
    throw new Error(`Network ${networkName} not configured. Available networks: ${Object.keys(config.networks).join(', ')}`);
  }
  
  console.log(`Deploying to ${networkName}...`);
  // The actual deployment logic is in the main function
  // This helper is just for clarity when running from scripts
}

// Execute deployment if script is run directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

// Export for programmatic usage
export { main };