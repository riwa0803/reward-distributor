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
9. [コントラクトアップグレード手順](#9-コントラクトアップグレード手順)
10. [トラブルシューティング](#10-トラブルシューティング)

## 1. システム概要

報酬配布システムは、ERC20/ERC721/ERC1155トークンをユーザーに配布するためのマルチチェーン対応システムです。主な特徴は以下の通りです：

- Airdrop管理と報酬配布の機能分離
- アップグレード可能なプロキシパターンの採用
- AirdropIDによるグループ化
- オンチェーンコミットメントによるセキュリティ強化
- 署名有効期限機能による安全性向上
- リトライメカニズムによる耐障害性
- バッチ処理によるガス最適化

### システムフロー

1. Airdrop作成者がAirdropを登録
2. 報酬提供者がアセットを登録
3. 報酬提供者が報酬を設定
4. ユーザーが報酬を確認
5. ユーザーが報酬請求の署名を取得
6. ユーザーが報酬を請求
7. バックエンドがイベントを検知して状態を更新

### シーケンス図

システム全体のフローは以下のシーケンス図を参照してください：

![全体フローシーケンス図](./sequence-diagrams/full-sequence-diagram.png)

オンチェーンフローの詳細は以下を参照してください：

![オンチェーンフローシーケンス図](./sequence-diagrams/onchain-flow.png)

## 2. スマートコントラクト実装

以下のスマートコントラクトを実装します：

### 2.1 RewardDistributorProxyAdmin

プロキシパターンの管理コントラクトです。

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

Airdrop情報を管理するコントラクトです。

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
    
    // ... イベント定義や実装詳細について「airdrop-registry.sol」を参照 ...
}
```

### 2.3 RewardDistributor

報酬配布機能を実装するコントラクトです。

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
    
    // ... 実装詳細について「reward-distributor.sol」を参照 ...
}
```

### 2.4 RewardDistributorProxy

プロキシコントラクトです。

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

以下の順序でデプロイを行います：

1. RewardDistributorProxyAdminをデプロイ
2. AirdropRegistry実装コントラクトをデプロイ
3. AirdropRegistryProxy（実装への参照）をデプロイ
4. RewardDistributor実装コントラクトをデプロイ
5. RewardDistributorProxy（実装への参照）をデプロイ
6. RewardDistributorにAirdropRegistryProxyのアドレスを設定

```typescript
// deploy.ts
import { ethers, upgrades } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with account: ${deployer.address}`);
  
  // 署名有効期限の設定（秒単位）- デフォルト: 1時間（3600秒）
  const SIGNATURE_EXPIRY_DURATION = 3600;
  // 検証用アドレス（バックエンド署名用）
  const VERIFIER_ADDRESS = process.env.VERIFIER_ADDRESS;
  
  if (!VERIFIER_ADDRESS) {
    throw new Error("VERIFIER_ADDRESS environment variable is not set");
  }

  // 1. プロキシ管理コントラクトのデプロイ
  console.log("Deploying RewardDistributorProxyAdmin...");
  const ProxyAdminFactory = await ethers.getContractFactory("RewardDistributorProxyAdmin");
  const proxyAdmin = await ProxyAdminFactory.deploy();
  await proxyAdmin.deployed();
  console.log(`RewardDistributorProxyAdmin deployed to: ${proxyAdmin.address}`);

  // 2. AirdropRegistry実装コントラクトのデプロイ
  console.log("Deploying AirdropRegistry implementation...");
  const AirdropRegistryFactory = await ethers.getContractFactory("AirdropRegistry");
  const airdropRegistryImpl = await AirdropRegistryFactory.deploy();
  await airdropRegistryImpl.deployed();
  console.log(`AirdropRegistry implementation deployed to: ${airdropRegistryImpl.address}`);

  // 3. AirdropRegistry初期化データの準備
  const airdropRegistryInitData = AirdropRegistryFactory.interface.encodeFunctionData("initialize");

  // 4. AirdropRegistryプロキシのデプロイ
  console.log("Deploying AirdropRegistryProxy...");
  const AirdropRegistryProxyFactory = await ethers.getContractFactory("RewardDistributorProxy");
  const airdropRegistryProxy = await AirdropRegistryProxyFactory.deploy(
    airdropRegistryImpl.address,
    airdropRegistryInitData,
    proxyAdmin.address
  );
  await airdropRegistryProxy.deployed();
  console.log(`AirdropRegistryProxy deployed to: ${airdropRegistryProxy.address}`);

  // 5. RewardDistributor実装コントラクトのデプロイ
  console.log("Deploying RewardDistributor implementation...");
  const RewardDistributorFactory = await ethers.getContractFactory("RewardDistributor");
  const rewardDistributorImpl = await RewardDistributorFactory.deploy();
  await rewardDistributorImpl.deployed();
  console.log(`RewardDistributor implementation deployed to: ${rewardDistributorImpl.address}`);

  // 6. RewardDistributor初期化データの準備
  const rewardDistributorInitData = RewardDistributorFactory.interface.encodeFunctionData(
    "initialize",
    [VERIFIER_ADDRESS, SIGNATURE_EXPIRY_DURATION]
  );

  // 7. RewardDistributorプロキシのデプロイ
  console.log("Deploying RewardDistributorProxy...");
  const RewardDistributorProxyFactory = await ethers.getContractFactory("RewardDistributorProxy");
  const rewardDistributorProxy = await RewardDistributorProxyFactory.deploy(
    rewardDistributorImpl.address,
    rewardDistributorInitData,
    proxyAdmin.address
  );
  await rewardDistributorProxy.deployed();
  console.log(`RewardDistributorProxy deployed to: ${rewardDistributorProxy.address}`);

  // 8. AirdropRegistryのアドレスをRewardDistributorに設定
  console.log("Setting AirdropRegistry address in RewardDistributor...");
  const rewardDistributor = RewardDistributorFactory.attach(rewardDistributorProxy.address);
  await rewardDistributor.setAirdropRegistry(airdropRegistryProxy.address);
  console.log("AirdropRegistry address set successfully");

  console.log("Deployment completed!");
  console.log({
    ProxyAdmin: proxyAdmin.address,
    AirdropRegistryImpl: airdropRegistryImpl.address,
    AirdropRegistryProxy: airdropRegistryProxy.address,
    RewardDistributorImpl: rewardDistributorImpl.address,
    RewardDistributorProxy: rewardDistributorProxy.address
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

## 3. バックエンド実装

### 3.1 データベーススキーマ設定

`database-schema.sql`ファイルに定義されたスキーマを使用します。主要なテーブルは以下です：

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

TypeScriptのインターフェースとして「バックエンドデータモデル.ts」に定義されています。主要なモデルには以下が含まれます：

- Airdrop
- ChainConfig
- Operator
- Asset（AssetType列挙型を含む）
- Reward（RewardStatus列挙型を含む）
- AirdropEventLog（AirdropEventType列挙型を含む）
- ContractType列挙型
- BlockScanHistory
- EventRetryQueue

### 3.3 API実装

以下のエンドポイントを実装します：

#### Airdrop管理API
- `POST /api/airdrops` - Airdropを登録
- `PUT /api/airdrops/:id/period` - Airdrop期間を更新
- `PUT /api/airdrops/:id/extend` - Airdrop期限を延長
- `PUT /api/airdrops/:id/status` - Airdropステータスを更新
- `GET /api/airdrops` - Airdrop一覧を取得

#### アセット・報酬管理API
- `POST /api/assets` - アセットを登録
- `PUT /api/assets/:id/provider` - アセット提供者を更新
- `PUT /api/assets/:id/status` - アセットステータスを更新
- `POST /api/rewards/batch` - 報酬バッチを登録
- `GET /api/rewards` - ユーザーの報酬一覧を取得
- `POST /api/rewards/prepare-claim` - 報酬請求の準備（署名生成）

実装例として、`nextjs-api-reward.ts`には報酬請求準備のAPIエンドポイント実装が、`nextjs-api-routes.ts`には報酬バッチ登録と報酬一覧取得のAPI実装が含まれています。

### 3.4 署名生成機能

署名生成機能は以下のステップで実装します：

1. 報酬情報の取得と検証
2. Airdropの有効性確認
3. オンチェーン状態の確認
4. ノンス値の取得
5. 署名の有効期限の設定
6. 署名の生成
7. 署名情報のデータベース保存
8. 署名情報の返却

詳細な実装は「バックエンドAPI実装-完全版.ts」のprepareRewardClaim関数を参照してください。

### 3.5 イベントリスナー

ブロックチェーンイベントを監視するリスナーを実装します：

1. AirdropRegistryイベントリスナー
   - `AirdropRegistered`イベント
   - `AirdropPeriodUpdated`イベント
   - `AirdropStatusUpdated`イベント
   - `OperatorAdded`/`OperatorRemoved`イベント

2. RewardDistributorイベントリスナー
   - `AssetRegistered`イベント
   - `AssetProviderUpdated`イベント
   - `AssetStatusUpdated`イベント
   - `RewardRegistered`イベント
   - `RewardCommitmentSet`イベント
   - `RewardClaimed`イベント

詳細な実装方法は「バックエンドAPI実装-完全版.ts」のlistenToAirdropRegistryEventsとlistenToRewardDistributorEvents関数を参照してください。

### 3.6 リトライメカニズム

イベント処理の耐障害性を向上させるため、以下のリトライメカニズムを実装します：

1. 失敗したイベント処理をリトライキューに登録
2. 指数バックオフによるリトライ間隔の設定
3. 定期的なリトライキュー処理
4. 永続的なエラーの検出と報告

詳細な実装は「バックエンドAPI実装-完全版.ts」のaddToRetryQueueとprocessRetryQueue関数を参照してください。

### 3.7 バックエンドサービス起動

以下のサービスを起動します：

```typescript
// index.ts
import express from 'express';
import { startEventListeners } from './services/event-listener';
import { startRetryProcessor } from './services/retry-processor';
import { apiRouter } from './api';

// Express設定
const app = express();
app.use(express.json());
app.use('/api', apiRouter);

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  
  // イベントリスナーの起動
  startEventListeners()
    .then(() => console.log('Event listeners started'))
    .catch(err => console.error('Failed to start event listeners:', err));
  
  // リトライプロセッサの起動
  startRetryProcessor()
    .then(() => console.log('Retry processor started'))
    .catch(err => console.error('Failed to start retry processor:', err));
});
```

## 4. フロントエンド実装

### 4.1 ウォレット連携コンポーネント

ウォレット接続を管理するコンポーネントを実装します。「nextjs-wallet-provider.ts」を参照してください。このコンポーネントは以下の機能を提供します：

- ウォレット接続/切断
- チェーンID取得
- ネットワーク切替
- アカウント変更検知

### 4.2 報酬表示コンポーネント

ユーザーの報酬一覧を表示するコンポーネントを実装します：

```tsx
// RewardsList.tsx
import React, { useEffect, useState } from 'react';
import { List, Card, Badge, Tag, Button } from 'antd';
import { useWallet } from '../providers/WalletProvider';
import ClaimRewardButton from './ClaimRewardButton';

const RewardsList = () => {
  const { account } = useWallet();
  const [rewards, setRewards] = useState([]);
  const [loading, setLoading] = useState(false);

  // 報酬データの取得
  useEffect(() => {
    if (!account) return;
    
    const fetchRewards = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/rewards?userAddress=${account}`);
        const data = await response.json();
        setRewards(data.rewards);
      } catch (error) {
        console.error('Error fetching rewards:', error);
      } finally {
        setLoading(false);
      }
    };
    
    fetchRewards();
  }, [account]);

  // 報酬カードのレンダリング
  const renderRewardCard = (reward) => (
    <List.Item>
      <Card 
        title={`${reward.airdropName} - ${reward.amount} ${reward.assetType === 0 ? 'Tokens' : 'NFTs'}`}
        extra={
          <Badge status={reward.status === 'CLAIMED' ? 'success' : 'processing'} 
                 text={reward.status === 'CLAIMED' ? '請求済み' : '未請求'} />
        }
      >
        <p>Airdrop ID: {reward.airdropId}</p>
        <p>Asset ID: {reward.assetId}</p>
        {reward.tokenId && <p>Token ID: {reward.tokenId}</p>}
        
        {reward.status === 'PENDING' && (
          <ClaimRewardButton 
            chainId={reward.chainId}
            assetId={reward.assetId}
            rewardId={reward.rewardId}
            airdropId={reward.airdropId}
            contractAddress={getContractAddress(reward.chainId)}
          />
        )}
      </Card>
    </List.Item>
  );

  return (
    <div>
      <h2>あなたの報酬一覧</h2>
      <List
        grid={{ gutter: 16, column: 2 }}
        dataSource={rewards}
        renderItem={renderRewardCard}
        loading={loading}
        locale={{ emptyText: 'No rewards found' }}
      />
    </div>
  );
};
```

### 4.3 報酬請求コンポーネント

個別の報酬請求ボタンを実装します。「nextjs-claim-component.ts」を参照してください。このコンポーネントは以下の機能を提供します：

- 署名の取得と表示
- 署名の有効期限の視覚的表示
- 報酬請求実行
- エラー処理と表示

### 4.4 バッチ請求コンポーネント

複数の報酬をまとめて請求するコンポーネントを実装します。「nextjs-batch-claim.ts」を参照してください。このコンポーネントは以下の機能を提供します：

- 複数報酬の選択
- バッチ署名取得
- 一括請求実行
- 期限切れ署名の検出と通知

### 4.5 フロントエンドページ構成

以下のページを実装します：

- ホームページ - システム概要と機能説明
- 報酬ページ - ユーザーの報酬一覧と請求機能
- Airdrop一覧ページ - アクティブなAirdropの表示
- Airdrop詳細ページ - 特定のAirdropの詳細情報と報酬
- 管理ページ - 管理者向けの設定と監視機能

## 5. デプロイ手順

### 5.1 環境設定

デプロイ前に以下の環境変数を設定します：

```
# .env.example
# スマートコントラクト
VERIFIER_ADDRESS=0x...
PRIVATE_KEY=0x...

# バックエンド
DATABASE_URL=postgres://user:password@localhost:5432/reward_db
RPC_URL_MAINNET=https://mainnet.infura.io/v3/YOUR_PROJECT_ID
RPC_URL_GOERLI=https://goerli.infura.io/v3/YOUR_PROJECT_ID
SIGNING_PRIVATE_KEY=0x...

# フロントエンド
NEXT_PUBLIC_CHAIN_ID=5
NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS=0x...
NEXT_PUBLIC_AIRDROP_REGISTRY_ADDRESS=0x...
```

### 5.2 コントラクトデプロイ

以下の手順でスマートコントラクトをデプロイします：

1. 環境変数の設定
   ```bash
   export VERIFIER_ADDRESS=0x...
   export PRIVATE_KEY=0x...
   ```

2. デプロイスクリプトの実行
   ```bash
   npx hardhat run scripts/deploy.ts --network goerli
   ```

3. コントラクトの検証
   ```bash
   npx hardhat verify --network goerli <CONTRACT_ADDRESS>
   ```

### 5.3 バックエンドデプロイ

以下の手順でバックエンドをデプロイします：

1. データベースのセットアップ
   ```bash
   psql -U postgres -c "CREATE DATABASE reward_db"
   psql -U postgres -d reward_db -f database-schema.sql
   ```

2. バックエンドビルドと起動
   ```bash
   cd backend
   npm install
   npm run build
   npm start
   ```

### 5.4 フロントエンドデプロイ

以下の手順でフロントエンドをデプロイします：

1. 環境変数の設定
   ```bash
   cp .env.example .env.local
   # .env.localを編集して適切な値を設定
   ```

2. ビルドと起動
   ```bash
   cd frontend
   npm install
   npm run build
   npm start
   ```

### 5.5 Docker Composeを使用したデプロイ

すべてのコンポーネントを一括でデプロイする場合：

```yaml
# docker-compose.yml
version: '3'
services:
  database:
    image: postgres:13
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: reward_db
    volumes:
      - ./database-schema.sql:/docker-entrypoint-initdb.d/init.sql
      - postgres_data:/var/lib/postgresql/data

  backend:
    build:
      context: .
      dockerfile: docker/backend.Dockerfile
    environment:
      DATABASE_URL: postgres://postgres:postgres@database:5432/reward_db
      RPC_URL_MAINNET: ${RPC_URL_MAINNET}
      RPC_URL_GOERLI: ${RPC_URL_GOERLI}
      SIGNING_PRIVATE_KEY: ${SIGNING_PRIVATE_KEY}
    depends_on:
      - database
    ports:
      - "3001:3001"

  frontend:
    build:
      context: .
      dockerfile: docker/frontend.Dockerfile
    environment:
      NEXT_PUBLIC_CHAIN_ID: ${NEXT_PUBLIC_CHAIN_ID}
      NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS: ${NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS}
      NEXT_PUBLIC_AIRDROP_REGISTRY_ADDRESS: ${NEXT_PUBLIC_AIRDROP_REGISTRY_ADDRESS}
      NEXT_PUBLIC_BACKEND_URL: http://backend:3001
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  postgres_data:
```

## 6. テスト計画

### 6.1 スマートコントラクトテスト

以下のテストを実装します：

1. 単体テスト
   - AirdropRegistry機能テスト
   - RewardDistributor機能テスト
   - プロキシ動作テスト

2. 統合テスト
   - コントラクト間連携テスト
   - アップグレード機能テスト
   - ガス最適化テスト

```typescript
// test/contracts/AirdropRegistry.test.ts
import { ethers } from "hardhat";
import { expect } from "chai";
import { AirdropRegistry } from "../../typechain";

describe("AirdropRegistry", function () {
  let airdropRegistry: AirdropRegistry;
  let owner: any, operator: any, creator: any, user: any;
  
  beforeEach(async function () {
    [owner, operator, creator, user] = await ethers.getSigners();
    
    const AirdropRegistryFactory = await ethers.getContractFactory("AirdropRegistry");
    airdropRegistry = await AirdropRegistryFactory.deploy();
    await airdropRegistry.initialize();
  });
  
  describe("Airdrop Registration", function () {
    it("Should register a new airdrop", async function () {
      const now = Math.floor(Date.now() / 1000);
      const startDate = now + 100;
      const endDate = now + 86400; // 1 day later
      const airdropId = 1;
      
      await airdropRegistry.registerAirdrop(airdropId, startDate, endDate);
      
      const airdrop = await airdropRegistry.airdrops(airdropId);
      expect(airdrop.startDate).to.equal(startDate);
      expect(airdrop.endDate).to.equal(endDate);
      expect(airdrop.isActive).to.be.true;
      expect(airdrop.creator).to.equal(owner.address);
    });
    
    // 他のテストケース...
  });
});
```

### 6.2 バックエンドテスト

以下のテストを実装します：

1. ユニットテスト
   - サービス層テスト
   - モデルテスト
   - APIエンドポイントテスト

2. 統合テスト
   - イベントリスナーテスト
   - リトライメカニズムテスト
   - データベーストランザクションテスト

```typescript
// test/backend/services/reward-service.test.ts
import { expect } from "chai";
import sinon from "sinon";
import { RewardService } from "../../../src/services/reward-service";
import { db } from "../../../src/database";

describe("RewardService", function () {
  let rewardService: RewardService;
  let dbStub: sinon.SinonStub;
  
  beforeEach(function () {
    dbStub = sinon.stub(db, "transaction");
    rewardService = new RewardService();
  });
  
  afterEach(function () {
    sinon.restore();
  });
  
  describe("prepareRewardClaim", function () {
    it("Should generate a signature for valid reward", async function () {
      // テストの実装...
    });
    
    // 他のテストケース...
  });
});
```

### 6.3 フロントエンドテスト

以下のテストを実装します：

1. コンポーネントテスト
   - UI要素のレンダリングテスト
   - ユーザーインタラクションテスト
   - 状態管理テスト

2. 統合テスト
   - APIリクエストモックテスト
   - ウォレット連携テスト
   - ルーティングテスト

```typescript
// test/frontend/components/ClaimRewardButton.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ClaimRewardButton from "../../../src/components/ClaimRewardButton";
import { WalletProvider } from "../../../src/providers/WalletProvider";

jest.mock("ethers", () => ({
  // モック実装...
}));

describe("ClaimRewardButton", () => {
  beforeEach(() => {
    // セットアップ...
  });
  
  test("renders correctly in initial state", () => {
    render(
      <WalletProvider>
        <ClaimRewardButton
          chainId={1}
          assetId={1}
          rewardId={1}
          airdropId={1}
          contractAddress="0x123"
        />
      </WalletProvider>
    );
    
    expect(screen.getByText("署名を取得して報酬請求を準備")).toBeInTheDocument();
  });
  
  // 他のテストケース...
});
```

### 6.4 E2Eテスト

エンドツーエンドのフローをテストします：

1. Airdrop作成からユーザー報酬請求までの全体フロー
2. エラーケースとリカバリー
3. パフォーマンステスト

## 7. セキュリティ考慮事項

### 7.1 スマートコントラクトセキュリティ

以下のセキュリティ対策を実装しています：

1. **権限管理**
   - 明確なロールベースのアクセス制御
   - オーナー、オペレーター、作成者の権限分離

2. **オンチェーンコミットメント**
   - 報酬パラメータのハッシュをオンチェーンで検証
   - 改ざん防止メカニズム

3. **署名有効期限**
   - 古い署名の再利用攻撃を防止
   - 時間制限付き署名検証

4. **リエントランシー対策**
   - ReentrancyGuardの使用
   - 状態変更後の外部呼び出し制限

5. **緊急停止機能**
   - Pausable機能によるシステム保護
   - 緊急時の操作停止

### 7.2 バックエンドセキュリティ

以下のセキュリティ対策を実装します：

1. **入力検証**
   - すべてのAPIリクエストの厳格なバリデーション
   - SQLインジェクション対策

2. **署名管理**
   - 秘密鍵の安全な管理（環境変数、KMS等）
   - 署名生成の監査ログ

3. **レート制限**
   - APIリクエストの制限
   - DoS攻撃対策

4. **エラー処理**
   - 適切なエラーメッセージ（情報漏洩防止）
   - リカバリーメカニズム

### 7.3 フロントエンドセキュリティ

以下のセキュリティ対策を実装します：

1. **入力サニタイズ**
   - ユーザー入力の適切な処理
   - XSS対策

2. **署名表示**
   - 有効期限の明示的な表示
   - セキュリティリスクの通知

3. **接続検証**
   - 適切なネットワーク確認
   - ウォレット接続状態の監視

## 8. 運用ガイドライン

### 8.1 システム監視

以下の項目を監視します：

1. コントラクトイベント
2. ガス価格と使用量
3. APIリクエスト数と応答時間
4. データベース負荷
5. 署名生成状況

### 8.2 バックアップと復旧

以下のバックアップ計画を実施します：

1. データベース定期バックアップ
2. 状態ログのアーカイブ
3. 復旧手順の整備と訓練

### 8.3 アップデート手順

以下のアップデート手順を整備します：

1. バックエンド・フロントエンドのアップデート計画
2. コントラクトアップグレード手順
3. データマイグレーション手順

## 9. コントラクトアップグレード手順

### 9.1 新しい実装のデプロイ

1. 新しい実装コントラクトをデプロイ
   ```bash
   npx hardhat run scripts/deploy-implementation.ts --network goerli
   ```

2. 実装の検証
   ```bash
   npx hardhat verify --network goerli <NEW_IMPLEMENTATION_ADDRESS>
   ```

### 9.2 プロキシのアップグレード

1. ProxyAdminを介してアップグレードを実行
   ```typescript
   // scripts/upgrade.ts
   import { ethers } from "hardhat";

   async function main() {
     const [deployer] = await ethers.getSigners();
     console.log(`Upgrading contracts with account: ${deployer.address}`);
     
     const proxyAdminAddress = "0x..."; // 既存のProxyAdminアドレス
     const proxyAddress = "0x..."; // アップグレード対象のプロキシアドレス
     const newImplementationAddress = "0x..."; // 新しい実装コントラクトのアドレス
     
     // ProxyAdminへの接続
     const ProxyAdmin = await ethers.getContractFactory("RewardDistributorProxyAdmin");
     const proxyAdmin = ProxyAdmin.attach(proxyAdminAddress);
     
     // アップグレードの実行
     console.log("Upgrading proxy implementation...");
     await proxyAdmin.upgrade(proxyAddress, newImplementationAddress);
     
     console.log(`Proxy at ${proxyAddress} upgraded to implementation at ${newImplementationAddress}`);
   }

   main()
     .then(() => process.exit(0))
     .catch((error) => {
       console.error(error);
       process.exit(1);
     });
   ```

2. アップグレードの確認
   ```typescript
   // scripts/verify-upgrade.ts
   import { ethers } from "hardhat";

   async function main() {
     const proxyAddress = "0x..."; // アップグレードしたプロキシのアドレス
     
     // 新しい実装経由で動作確認
     const Contract = await ethers.getContractFactory("RewardDistributor"); // または AirdropRegistry
     const contract = Contract.attach(proxyAddress);
     
     // 動作確認
     const verifier = await contract.verifier();
     console.log(`Current verifier address: ${verifier}`);
     
     console.log("Upgrade verification completed!");
   }

   main()
     .then(() => process.exit(0))
     .catch((error) => {
       console.error(error);
       process.exit(1);
     });
   ```

## 10. トラブルシューティング

### 10.1 スマートコントラクト関連

1. **トランザクション失敗**
   - 問題: トランザクションが失敗する
   - 解決: ガス価格、ノンス値、パラメータを確認してください
   
2. **署名検証失敗**
   - 問題: 「Invalid signature」エラーが発生する
   - 解決: バックエンドの署名キーとコントラクトの検証者アドレスが一致しているか確認してください
   
3. **コントラクト間連携エラー**
   - 問題: AirdropRegistryとRewardDistributorの連携が機能しない
   - 解決: setAirdropRegistry関数が正常に呼び出されたか確認してください

### 10.2 バックエンド関連

1. **イベント監視停止**
   - 問題: イベントリスナーが停止している
   - 解決: ログを確認し、必要に応じてリスナーを再起動してください
   
2. **データベース接続エラー**
   - 問題: データベース接続が切断される
   - 解決: 接続プール設定を見直し、再接続ロジックを確認してください
   
3. **署名生成エラー**
   - 問題: 署名が生成できない
   - 解決: 秘密鍵の設定を確認し、必要に応じて再生成してください

### 10.3 フロントエンド関連

1. **ウォレット接続エラー**
   - 問題: ウォレットが接続できない
   - 解決: サポートするウォレットタイプとネットワーク設定を確認してください
   
2. **報酬表示エラー**
   - 問題: 報酬が表示されない
   - 解決: APIエンドポイント、ウォレットアドレス、ネットワーク設定を確認してください
   
3. **署名期限切れ**
   - 問題: 署名が期限切れになる前に請求できない
   - 解決: 署名有効期限を延長するか、UIで十分な警告を表示してください

## 付録

### A. APIリファレンス

詳細なAPI仕様については、`api-docs.md`を参照してください。

### B. フロントエンドコンポーネント設計

詳細なコンポーネント設計とプロパティについては、フロントエンドドキュメントを参照してください。

### C. データベースマイグレーション

データベーススキーマのバージョン管理と更新方法については、マイグレーションガイドを参照してください。