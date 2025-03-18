// デプロイスクリプト例 - Hardhat環境用（署名有効期限対応版）
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

    // 実装コントラクトをデプロイ
    console.log("Deploying RewardDistributor implementation...");
    const RewardDistributorFactory = await ethers.getContractFactory("RewardDistributor");
    const rewardDistributorImpl = await RewardDistributorFactory.deploy();
    await rewardDistributorImpl.deployed();
    console.log(`RewardDistributor implementation deployed to: ${rewardDistributorImpl.address}`);

    // 初期化データの準備（署名有効期限パラメータ追加）
    const initData = RewardDistributorFactory.interface.encodeFunctionData("initialize", [
      chain.verifier,
      SIGNATURE_EXPIRY_DURATION
    ]);

    // プロキシコントラクトをデプロイ
    console.log("Deploying RewardDistributorProxy...");
    const ProxyFactory = await ethers.getContractFactory("RewardDistributorProxy");
    const proxy = await ProxyFactory.deploy(
      rewardDistributorImpl.address,
      initData,
      proxyAdmin.address
    );
    await proxy.deployed();
    console.log(`RewardDistributorProxy deployed to: ${proxy.address}`);

    // インスタンスを取得して機能確認
    const rewardDistributor = RewardDistributorFactory.attach(proxy.address);
    const verifier = await rewardDistributor.verifier();
    const expiryDuration = await rewardDistributor.signatureExpiryDuration();
    console.log(`Configured verifier address: ${verifier}`);
    console.log(`Configured signature expiry duration: ${expiryDuration} seconds`);

    // デプロイ情報をファイルに保存
    saveDeploymentInfo(chain.name, {
      proxyAdmin: proxyAdmin.address,
      implementation: rewardDistributorImpl.address,
      proxy: proxy.address,
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