# 報酬配布システム - エンジニア向け実装指示書

本書は報酬配布システムの実装に必要な手順と詳細を説明するものです。各コンポーネントの実装方法、相互連携の方法、およびテスト手順を記述しています。

## 目次

1. [システム概要](#1-システム概要)
2. [スマートコントラクト実装](#2-スマートコントラクト実装)
3. [バックエンド実装](#3-バックエンド実装)
4. [フロントエンド実装](#4-フロントエンド実装)
5. [デプロイ手順](#5-デプロイ手順)
6. [テスト計画](#6-テスト計画)
7. [セキュリティ考慮事項](#7-セキュリティ考慮事項)
8. [運用ガイドライン](#8-運用ガイドライン)

## 1. システム概要

報酬配布システムは、ERC20/ERC721/ERC1155トークンをユーザーに配布するためのマルチチェーン対応システムです。主な特徴は以下の通りです：

- Airdrop管理と報酬配布の機能分離
- アップグレード可能なプロキシパターンの採用
- AirdropIDによるグループ化
- オンチェーンコミットメントによるセキュリティ強化
- 署名有効期限機能による安全性向上
- リトライメカニズムによる耐障害性

### システムフロー

1. Airdrop作成者がAirdropを登録
2. 報酬提供者がアセットを登録
3. 報酬提供者が報酬を設定
4. ユーザーが報酬を確認
5. ユーザーが報酬請求の署名を取得
6. ユーザーが報酬を請求
7. バックエンドがイベントを検知して状態を更新

## 2. スマートコントラクト実装

以下のスマートコントラクトを実装します：

### 2.1 RewardDistributorProxyAdmin

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

contract RewardDistributorProxyAdmin is ProxyAdmin {
    constructor() {
        // デフォルトの管理者は deployer
    }
}
```

### 2.2 AirdropRegistry

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

contract AirdropRegistry is 
    Initializable, 
    UUPSUpgradeable, 
    OwnableUpgradeable,
    PausableUpgradeable {
    
    // Airdrop情報の構造体
    struct Airdrop {
        uint256 startDate;    // 開始日時（UNIXタイムスタンプ）
        uint256 endDate;      // 終了日時（UNIXタイムスタンプ）
        bool isActive;        // 有効状態
        address creator;      // 作成者
    }
    
    // AirdropIDからAirdrop情報へのマッピング
    mapping(uint256 => Airdrop) public airdrops;
    
    // オペレータ権限のマッピング
    mapping(address => bool) public operators;
    
    // ... 実装詳細は省略 ...
}
```

### 2.3 RewardDistributor

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

// AirdropRegistryインターフェース
interface IAirdropRegistry {
    function isAirdropValid(uint256 airdropId) external view returns (bool isValid, uint256 endDate);
}

contract RewardDistributor is 
    Initializable, 
    UUPSUpgradeable, 
    OwnableUpgradeable, 
    ReentrancyGuardUpgradeable,
    PausableUpgradeable {
    
    // ... 実装詳細は省略 ...
}
```

### 2.4 RewardDistributorProxy

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract RewardDistributorProxy is ERC1967Proxy {
    constructor(
        address _implementation,
        bytes memory _data,
        address _admin
    ) ERC1967Proxy(_implementation, _data) {
        // プロキシ管理者を設定
        assembly {
            sstore(0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103, _admin)
        }
    }
}
```

### 2.5 デプロイスクリプト

以下の手順でデプロイを行います：

1. RewardDistributorProxyAdminをデプロイ
2. AirdropRegistry実装コントラクトをデプロイ
3. AirdropRegistryProxy（実装への参照）をデプロイ
4. RewardDistributor実装コントラクトをデプロイ
5. RewardDistributorProxy（実装への参照）をデプロイ
6. RewardDistributorにAirdropRegistryProxyのアドレスを設定

```typescript
// deployment-script.ts
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

  // ... 残りのデプロイ手順を実装 ...
}
```

## 3. バックエンド実装

### 3.1 データベーススキーマ設定

更新されたデータベーススキーマには以下のテーブルが含まれます：

- airdrops（オンチェーンIDと作成者アドレスを追加）
- chains（AirdropRegistryアドレスを追加）
- operators（オペレーター管理用の新テーブル）
- assets
- rewards（署名有効期限対応）
- reward_claim_logs
- airdrop_event_logs（Airdropイベント用の新テーブル）
- reward_update_retry_queue
- block_scan_history（コントラクトタイプを追加）
- system_settings

### 3.2 データモデル実装

更新されたデータモデルは以下の通りです：

```typescript
// TypeScript型定義
interface Airdrop {
    id: number;
    onchainId: number;
    name: string;
    description: string;
    imageUrl?: string;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    creatorAddress: string;
    createdAt: Date;
    updatedAt: Date;
}

interface ChainConfig {
    chainId: number;
    chainName: string;
    rpcUrl: string;
    airdropRegistryAddress: string;
    rewardDistributorAddress: string;
}

interface Operator {
    chainId: number;
    operatorAddress: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

enum AssetType {
    ERC20 = 0,
    ERC721 = 1,
    ERC1155 = 2
}

interface Asset {
    chainId: number;
    assetId: number;
    tokenAddress: string;
    assetType: AssetType;
    providerAddress: string;
    isActive: boolean;
}

enum RewardStatus {
    PENDING = 'PENDING',
    CLAIMED = 'CLAIMED',
    FAILED = 'FAILED'
}

interface Reward {
    id: number;
    chainId: number;
    assetId: number;
    rewardId: number;
    airdropId: number;
    userAddress: string;
    amount: number;
    tokenId?: number;
    status: RewardStatus;
    signature?: string;
    signatureTimestamp?: number;
    signatureExpiresAt?: Date;
    transactionHash?: string;
    blockNumber?: number;
    claimedAt?: Date;
    onchainCommitment?: string;
    createdAt: Date;
    updatedAt: Date;
}

enum AirdropEventType {
    CREATED = 'CREATED',
    UPDATED = 'UPDATED',
    EXTENDED = 'EXTENDED',
    DISABLED = 'DISABLED'
}

interface AirdropEventLog {
    id: number;
    chainId: number;
    airdropId: number;
    eventType: AirdropEventType;
    transactionHash: string;
    blockNumber: number;
    creatorAddress?: string;
    startDate?: Date;
    endDate?: Date;
    isActive?: boolean;
    createdAt: Date;
}
```

### 3.3 API実装

以下のAPIエンドポイントを実装します：

1. Airdrop管理API
   - registerAirdrop: Airdropを登録
   - updateAirdropPeriod: Airdrop期間を更新
   - extendAirdropPeriod: Airdrop期限を延長
   - updateAirdropStatus: Airdropステータスを更新
   - getAirdrops: Airdrop一覧を取得

2. アセット・報酬管理API
   - registerAsset: アセットを登録
   - updateAssetProvider: アセット提供者を更新
   - updateAssetStatus: アセットステータスを更新
   - registerRewardBatch: 報酬バッチを登録
   - getUserRewards: ユーザーの報酬一覧を取得
   - prepareRewardClaim: 報酬請求の準備（署名生成）

3. イベント処理API
   - handleAirdropEvents: AirdropRegistryイベントの処理
   - handleRewardEvents: RewardDistributorイベントの処理

### 3.4 署名生成機能 (有効期限付き)

```typescript
export async function prepareRewardClaim(
  chainId: number,
  assetId: number,
  rewardId: number,
  userAddress: string
): Promise<{
  chainId: number;
  assetId: number;
  rewardId: number;
  airdropId: number;
  amount: number;
  tokenId: number;
  nonce: number;
  timestamp: number;
  signature: string;
  expiresAt: Date;
}> {
  // 報酬の存在確認
  const reward = await db('rewards')
    .where({
      chain_id: chainId,
      asset_id: assetId,
      reward_id: rewardId,
      user_address: userAddress.toLowerCase()
    })
    .first();
  
  if (!reward) {
    throw new Error(`Reward not found for user ${userAddress}`);
  }
  
  // 報酬のステータス確認
  if (reward.status !== RewardStatus.PENDING) {
    throw new Error(`Reward already ${reward.status.toLowerCase()}`);
  }
  
  // Airdropの有効性確認
  const airdrop = await db('airdrops')
    .where({ id: reward.airdrop_id })
    .first();
  
  if (!airdrop || !airdrop.is_active) {
    throw new Error('Associated Airdrop is not active');
  }
  
  // AirdropRegistryでオンチェーン状態を確認
  const chainConfig = getChainConfig(chainId);
  const airdropRegistryProvider = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrl);
  const airdropRegistry = new ethers.Contract(
    chainConfig.airdropRegistryAddress,
    AirdropRegistryABI,
    airdropRegistryProvider
  );
  
  const [isAirdropValid, ] = await airdropRegistry.isAirdropValid(airdrop.onchain_id);
  if (!isAirdropValid) {
    throw new Error('Airdrop is not valid on-chain');
  }
  
  // RewardDistributorコントラクトの参照
  const provider = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrl);
  const contract = new ethers.Contract(
    chainConfig.rewardDistributorAddress,
    RewardDistributorABI,
    provider
  );
  
  // オンチェーンの請求状態を確認
  const isClaimed = await contract.isRewardClaimed(assetId, rewardId);
  if (isClaimed) {
    throw new Error('Reward already claimed on-chain');
  }
  
  // ノンス値の取得
  const nonce = await contract.getNonce(userAddress);
  
  // コントラクトから署名有効期間を取得
  const signatureExpiryDuration = await contract.signatureExpiryDuration();
  
  // 現在のタイムスタンプ（秒）
  const timestamp = Math.floor(Date.now() / 1000);
  
  // 有効期限の計算
  const expiresAt = new Date((timestamp + signatureExpiryDuration.toNumber()) * 1000);
  
  // 署名生成
  const messageHash = ethers.utils.solidityKeccak256(
    ['uint256', 'address', 'uint256', 'uint256', 'uint256', 'uint256'],
    [chainId, userAddress, assetId, rewardId, nonce, timestamp]
  );
  
  const signingKey = new ethers.utils.SigningKey(process.env.SIGNING_PRIVATE_KEY as string);
  const signature = ethers.utils.joinSignature(signingKey.signDigest(ethers.utils.arrayify(messageHash)));
  
  // 署名をデータベースに保存
  await db('rewards')
    .where({
      chain_id: chainId,
      asset_id: assetId,
      reward_id: rewardId
    })
    .update({
      signature: signature,
      signature_timestamp: timestamp,
      signature_expires_at: expiresAt,
      updated_at: new Date()
    });
  
  // 請求情報を返却
  return {
    chainId,
    assetId,
    rewardId,
    airdropId: airdrop.onchain_id,
    amount: reward.amount,
    tokenId: reward.token_id || 0,
    nonce: nonce.toNumber(),
    timestamp,
    signature,
    expiresAt
  };
}
```

### 3.5 イベントリスナー設定

以下のイベントリスナーを実装します：

1. AirdropRegistryイベントリスナー
   - AirdropRegisteredイベント
   - AirdropPeriodUpdatedイベント
   - AirdropStatusUpdatedイベント
   - OperatorAddedイベント
   - OperatorRemovedイベント

2. RewardDistributorイベントリスナー
   - AssetRegisteredイベント
   - AssetProviderUpdatedイベント
   - AssetStatusUpdatedイベント
   - RewardRegisteredイベント
   - RewardCommitmentSetイベント
   - RewardClaimedイベント

```typescript
// AirdropRegistryイベントリスナー
export async function listenToAirdropRegistryEvents(chainId: number): Promise<void> {
  const chainConfig = getChainConfig(chainId);
  const provider = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrl);
  const airdropRegistry = new ethers.Contract(
    chainConfig.airdropRegistryAddress,
    AirdropRegistryABI,
    provider
  );
  
  // 最後に処理したブロックの取得
  const lastScannedBlock = await getLastScannedBlock(chainId, 'AIRDROP_REGISTRY');
  
  // AirdropRegisteredイベントのリスニング
  airdropRegistry.on('AirdropRegistered', async (airdropId, startDate, endDate, creator, event) => {
    try {
      // イベント処理
      await handleAirdropRegisteredEvent(chainId, airdropId, startDate, endDate, creator, event);
    } catch (error) {
      // エラー処理とリトライキューへの追加
      await addToRetryQueue({
        chainId,
        contractType: 'AIRDROP_REGISTRY',
        eventName: 'AirdropRegistered',
        params: { airdropId, startDate, endDate, creator },
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        error: error.toString()
      });
    }
  });
  
  // 他のイベントリスナーも同様に実装
}

// RewardDistributorイベントリスナー
export async function listenToRewardDistributorEvents(chainId: number): Promise<void> {
  const chainConfig = getChainConfig(chainId);
  const provider = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrl);
  const rewardDistributor = new ethers.Contract(
    chainConfig.rewardDistributorAddress,
    RewardDistributorABI,
    provider
  );
  
  // 最後に処理したブロックの取得
  const lastScannedBlock = await getLastScannedBlock(chainId, 'REWARD_DISTRIBUTOR');
  
  // RewardRegisteredイベントのリスニング
  rewardDistributor.on('RewardRegistered', async (assetId, airdropId, rewardId, recipient, amount, tokenId, event) => {
    try {
      // イベント処理
      await handleRewardRegisteredEvent(chainId, assetId, airdropId, rewardId, recipient, amount, tokenId, event);
    } catch (error) {
      // エラー処理とリトライキューへの追加
      await addToRetryQueue({
        chainId,
        contractType: 'REWARD_DISTRIBUTOR',
        eventName: 'RewardRegistered',
        params: { assetId, airdropId, rewardId, recipient, amount, tokenId },
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        error: error.toString()
      });
    }
  });
  
  // 他のイベントリスナーも同様に実装
}
```

### 3.6 リトライメカニズム

```typescript
// リトライキューへの追加
export async function addToRetryQueue(data: {
  chainId: number;
  contractType: 'AIRDROP_REGISTRY' | 'REWARD_DISTRIBUTOR';
  eventName: string;
  params: any;
  transactionHash: string;
  blockNumber: number;
  error: string;
}): Promise<void> {
  await db('event_retry_queue').insert({
    chain_id: data.chainId,
    contract_type: data.contractType,
    event_name: data.eventName,
    params: JSON.stringify(data.params),
    transaction_hash: data.transactionHash,
    block_number: data.blockNumber,
    retry_count: 0,
    next_retry_at: new Date(Date.now() + 60000), // 1分後に最初の再試行
    last_error: data.error,
    created_at: new Date(),
    updated_at: new Date()
  });
}

// リトライキューの処理
export async function processRetryQueue(): Promise<void> {
  const retryItems = await db('event_retry_queue')
    .where('next_retry_at', '<=', new Date())
    .limit(100); // バッチサイズを制限

  for (const item of retryItems) {
    try {
      const params = JSON.parse(item.params);
      
      // コントラクトタイプに応じたイベント処理
      if (item.contract_type === 'AIRDROP_REGISTRY') {
        await processAirdropRegistryEvent(item.chain_id, item.event_name, params, {
          transactionHash: item.transaction_hash,
          blockNumber: item.block_number
        });
      } else if (item.contract_type === 'REWARD_DISTRIBUTOR') {
        await processRewardDistributorEvent(item.chain_id, item.event_name, params, {
          transactionHash: item.transaction_hash,
          blockNumber: item.block_number
        });
      }
      
      // 成功した場合はリトライキューから削除
      await db('event_retry_queue')
        .where('id', item.id)
        .del();
    } catch (error) {
      // 再試行回数と次回試行時間を更新
      const newRetryCount = item.retry_count + 1;
      const backoffTime = Math.pow(2, newRetryCount) * 60000; // 指数バックオフ

      await db('event_retry_queue')