// デプロイスクリプト - Hardhat環境用（Airdrop Registry対応版）
import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);
  
  // 署名有効期限の設定（秒単位）- デフォルト: 1時間（3600秒）
  const SIGNATURE_EXPIRY_DURATION = 3600;

  // プロキシ管理コントラクトのデプロイ
  console.log("Deploying RewardDistributorProxyAdmin...");
  const ProxyAdminFactory = await ethers.getContractFactory("RewardDistributorProxyAdmin");
  const proxyAdmin = await ProxyAdminFactory.deploy();
  await proxyAdmin.deployed();
  console.log(`RewardDistributorProxyAdmin deployed to: ${proxyAdmin.address}`);

  // 複数チェーン用のデプロイ情報
  const chains = [
    {
      name: "HomeVerse",
      verifier: "0xVerifierAddress1"
    },
    {
      name: "Layer2Verse",
      verifier: "0xVerifierAddress2"
    }
  ];

  // 各チェーンにコントラクトをデプロイ
  for (const chain of chains) {
    console.log(`\nDeploying to ${chain.name}...`);

    // AirdropRegistry実装コントラクトをデプロイ
    console.log("Deploying AirdropRegistry implementation...");
    const AirdropRegistryFactory = await ethers.getContractFactory("AirdropRegistry");
    const airdropRegistryImpl = await AirdropRegistryFactory.deploy();
    await airdropRegistryImpl.deployed();
    console.log(`AirdropRegistry implementation deployed to: ${airdropRegistryImpl.address}`);

    // AirdropRegistry初期化データの準備
    const airdropRegistryInitData = AirdropRegistryFactory.interface.encodeFunctionData("initialize", []);

    // AirdropRegistryプロキシコントラクトをデプロイ
    console.log("Deploying AirdropRegistryProxy...");
    const AirdropProxyFactory = await ethers.getContractFactory("RewardDistributorProxy");
    const airdropRegistryProxy = await AirdropProxyFactory.deploy(
      airdropRegistryImpl.address,
      airdropRegistryInitData,
      proxyAdmin.address
    );
    await airdropRegistryProxy.deployed();
    console.log(`AirdropRegistryProxy deployed to: ${airdropRegistryProxy.address}`);

    // RewardDistributor実装コントラクトをデプロイ
    console.log("Deploying RewardDistributor implementation...");
    const RewardDistributorFactory = await ethers.getContractFactory("RewardDistributor");
    const rewardDistributorImpl = await RewardDistributorFactory.deploy();
    await rewardDistributorImpl.deployed();
    console.log(`RewardDistributor implementation deployed to: ${rewardDistributorImpl.address}`);

    // RewardDistributor初期化データの準備（署名有効期限パラメータ追加）
    const rewardDistributorInitData = RewardDistributorFactory.interface.encodeFunctionData("initialize", [
      chain.verifier,
      SIGNATURE_EXPIRY_DURATION
    ]);

    // RewardDistributorプロキシコントラクトをデプロイ
    console.log("Deploying RewardDistributorProxy...");
    const RewardProxyFactory = await ethers.getContractFactory("RewardDistributorProxy");
    const rewardDistributorProxy = await RewardProxyFactory.deploy(
      rewardDistributorImpl.address,
      rewardDistributorInitData,
      proxyAdmin.address
    );
    await rewardDistributorProxy.deployed();
    console.log(`RewardDistributorProxy deployed to: ${rewardDistributorProxy.address}`);

    // インスタンスを取得して機能確認
    const airdropRegistry = AirdropRegistryFactory.attach(airdropRegistryProxy.address);
    const rewardDistributor = RewardDistributorFactory.attach(rewardDistributorProxy.address);
    
    // AirdropRegistryのアドレスをRewardDistributorに設定
    console.log("Setting AirdropRegistry address in RewardDistributor...");
    await rewardDistributor.setAirdropRegistry(airdropRegistryProxy.address);
    console.log("AirdropRegistry address set successfully");
    
    // 設定を確認
    const verifier = await rewardDistributor.verifier();
    const expiryDuration = await rewardDistributor.signatureExpiryDuration();
    const registryAddress = await rewardDistributor.airdropRegistry();
    console.log(`Configured verifier address: ${verifier}`);
    console.log(`Configured signature expiry duration: ${expiryDuration} seconds`);
    console.log(`Configured AirdropRegistry address: ${registryAddress}`);

    // デプロイ情報をファイルに保存
    saveDeploymentInfo(chain.name, {
      proxyAdmin: proxyAdmin.address,
      airdropRegistryImplementation: airdropRegistryImpl.address,
      airdropRegistryProxy: airdropRegistryProxy.address,
      rewardDistributorImplementation: rewardDistributorImpl.address,
      rewardDistributorProxy: rewardDistributorProxy.address,
      verifier: chain.verifier,
      signatureExpiryDuration: SIGNATURE_EXPIRY_DURATION
    });
  }

  console.log("\nDeployment completed successfully!");
}

function saveDeploymentInfo(chain: string, info: any) {
  const fs = require("fs");
  const path = require("path");
  
  // デプロイ情報のディレクトリを作成
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }
  
  // チェーン固有のディレクトリを作成
  const chainDir = path.join(deploymentsDir, chain);
  if (!fs.existsSync(chainDir)) {
    fs.mkdirSync(chainDir);
  }
  
  // 情報をJSONファイルに書き込み
  const filePath = path.join(chainDir, "deployment.json");
  fs.writeFileSync(filePath, JSON.stringify(info, null, 2));
  console.log(`Deployment info saved to ${filePath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });