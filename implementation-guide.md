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

- アップグレード可能なプロキシパターンの採用
- AirdropIDによるグループ化
- オンチェーンコミットメントによるセキュリティ強化
- 署名有効期限機能による安全性向上
- リトライメカニズムによる耐障害性

### システムフロー

1. 管理者がAirdropを登録
2. 報酬提供者がアセットを登録
3. 報酬提供者/管理者が報酬を設定
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

### 2.2 RewardDistributorProxy

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

### 2.3 RewardDistributor (署名有効期限対応版)

提供された`RewardDistributor.sol（署名有効期限追加版）.txt`の内容を使用して実装します。主な機能は：

- アセット登録と管理
- 報酬登録と管理
- コミットメント検証
- 署名検証と有効期限チェック
- 報酬請求処理

### 2.4 デプロイスクリプト

`DeploymentScriptUpdate.ts`を使用して、以下の手順でデプロイします：

1. RewardDistributorProxyAdminをデプロイ
2. 各チェーンに対して：
   - RewardDistributor実装コントラクトをデプロイ
   - 初期化データを準備（署名有効期限を含む）
   - RewardDistributorProxyをデプロイ
   - 設定を確認

## 3. バックエンド実装

### 3.1 データベーススキーマ設定

提供された`報酬配布システム - 完全なデータベーススキーマ.txt`を使用して、以下のテーブルを作成します：

- airdrops
- chains
- assets
- rewards（署名有効期限対応）
- reward_claim_logs
- reward_update_retry_queue
- block_scan_history
- system_settings

### 3.2 データモデル実装

`改善版 バックエンドデータモデル.txt`を参考に、以下のインターフェースを実装します：

```typescript
// TypeScript型定義
interface Airdrop {
    id: number;
    name: string;
    description: string;
    imageUrl?: string;
    startDate: Date;
    endDate: Date;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

interface ChainConfig {
    chainId: number;
    chainName: string;
    rpcUrl: string;
    rewardContractAddress: string;
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
    transactionHash?: string;
    blockNumber?: number;
    claimedAt?: Date;
    onchainCommitment?: string;
    signatureTimestamp?: number;
    signatureExpiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}
```

### 3.3 API実装

以下のAPIエンドポイントを実装します：

1. Airdrop管理API
   - createAirdrop: Airdropを登録
   - updateAirdrop: Airdrop情報を更新
   - getAirdrops: Airdrop一覧を取得

2. 報酬管理API
   - registerRewardBatch: 報酬バッチを登録
   - getUserRewards: ユーザーの報酬一覧を取得
   - prepareRewardClaim: 報酬請求の準備（署名生成）

3. イベント処理API
   - handleRewardRegisteredEvent: RewardRegisteredイベントの処理
   - handleRewardClaimedEvent: RewardClaimedイベントの処理

### 3.4 署名生成機能 (有効期限付き)

`PrepareRewardClaim.ts（署名有効期限追加版）`を参考に、以下の機能を実装します：

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
  amount: number;
  tokenId: number;
  nonce: number;
  timestamp: number;
  signature: string;
  expiresAt: Date;
}> {
  // 報酬の存在・状態確認
  // オンチェーン状態確認
  // ノンス取得
  // 署名有効期間取得
  // タイムスタンプ生成
  // 署名生成
  // DB保存
  // 結果返却
}
```

### 3.5 イベントリスナー設定

以下のイベントリスナーを実装します：

1. RewardRegisteredイベントリスナー
   - コントラクトで登録された報酬情報を検知
   - オンチェーンコミットメントの取得
   - 報酬情報のDB保存

2. RewardClaimedイベントリスナー
   - ユーザーの報酬請求を検知
   - 報酬ステータスの更新
   - 監査ログの記録

### 3.6 リトライメカニズム

障害時のリトライ処理を実装します：

1. addToRetryQueue: イベント処理失敗時にリトライキューに追加
2. processRetryQueue: 定期的にリトライキューを処理（指数バックオフ）

### 3.7 ミッセドイベント検出

以下の機能を実装して、見逃したイベントを検出・処理します：

1. scanForMissedEvents: 指定ブロック範囲のイベントをスキャン
2. scheduleMissedEventScans: 定期的なスキャンをスケジュール

## 4. フロントエンド実装

### 4.1 報酬表示コンポーネント

ユーザーの報酬一覧を表示するコンポーネントを実装します：

- Airdropごとのグループ化表示
- 報酬の詳細情報表示
- ステータス（未請求/請求済み）の表示

### 4.2 報酬請求コンポーネント

`ClaimRewardComponent.tsx`を参考に、以下の機能を持つコンポーネントを実装します：

```typescript
import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';

export const ClaimRewardButton: React.FC<ClaimRewardProps> = ({
  chainId,
  assetId,
  rewardId,
  contractAddress
}) => {
  // 署名リクエスト処理
  const requestSignature = async () => {
    // ウォレット接続
    // バックエンドからの署名取得
    // 有効期限管理状態の設定
  };

  // 報酬請求実行
  const executeClaimReward = async () => {
    // コントラクト呼び出し
    // トランザクション処理
    // 結果表示
  };

  // 有効期限表示と残り時間の計算
  // UI実装
}
```

### 4.3 署名有効期限表示

署名の有効期限を視覚的に表示する機能を実装します：

- 残り時間のカウントダウン
- プログレスバーによる視覚的表示
- 期限切れ時の再取得ボタン表示

## 5. デプロイ手順

### 5.1 スマートコントラクトデプロイ

1. 環境設定（Hardhat/Truffle）
2. デプロイスクリプト実行
3. コントラクトアドレスの保存
4. デプロイ情報の検証

### 5.2 バックエンドデプロイ

1. データベースセットアップ
   ```sql
   -- スキーマ作成
   CREATE DATABASE rewards_db;
   
   -- テーブル作成
   -- 提供されたスキーマSQLを実行
   ```

2. 環境変数設定
   ```
   # 必要な環境変数
   SIGNING_PRIVATE_KEY=YOUR_PRIVATE_KEY
   DATABASE_URL=postgres://user:password@localhost:5432/rewards_db
   LOG_LEVEL=info
   
   # チェーン固有の設定
   CHAIN_1_RPC_URL=https://mainnet.example.com/json-rpc
   CHAIN_1_REWARD_CONTRACT=0x1234...
   CHAIN_1_CONFIRMATIONS=12
   
   CHAIN_2_RPC_URL=https://testnet.example.com/json-rpc
   CHAIN_2_REWARD_CONTRACT=0x5678...
   CHAIN_2_CONFIRMATIONS=6
   ```

3. バックエンドサービス起動
   - APIサーバー起動
   - イベントリスナー起動
   - スケジュールタスク設定

### 5.3 フロントエンドデプロイ

1. ビルド設定
2. 環境変数設定
3. ビルドと検証
4. CDNまたはウェブサーバーにデプロイ

## 6. テスト計画

### 6.1 スマートコントラクトテスト

1. 単体テスト
   - アセット登録・管理機能
   - 報酬登録・管理機能
   - 署名検証とノンス管理
   - 報酬請求処理

2. 統合テスト
   - プロキシパターンの動作確認
   - アップグレード機能の検証
   - 複数チェーンでの動作検証

### 6.2 バックエンドテスト

1. 単体テスト
   - データモデル検証
   - API機能検証
   - 署名生成と検証
   - イベント処理ロジック

2. 統合テスト
   - データベース連携
   - コントラクトイベント処理
   - リトライメカニズム検証

3. 負荷テスト
   - 大量報酬データ処理
   - 多数ユーザーからの同時リクエスト
   - イベント処理の並行性

### 6.3 フロントエンドテスト

1. 単体テスト
   - コンポーネント機能検証
   - ユーザーインタラクション
   - エラーハンドリング

2. E2Eテスト
   - 報酬表示からクレームまでのフロー
   - 署名期限切れのケース
   - エラー状態からの復帰

## 7. セキュリティ考慮事項

### 7.1 スマートコントラクトセキュリティ

1. 権限管理
   - 適切なアクセス制御（onlyOwner, onlyProvider）
   - プロキシパターンの権限分離

2. 署名検証
   - 正しいメッセージハッシュ構造
   - ノンス管理による再生攻撃防止
   - 署名有効期限チェック

3. リエントランシー対策
   - nonReentrant修飾子の使用
   - 状態変更後の外部呼び出し

### 7.2 バックエンドセキュリティ

1. 秘密鍵管理
   - 環境変数またはシークレット管理サービス使用
   - AWS KMSやGoogle Cloud KMSの活用
   - 定期的な鍵のローテーション

2. API保護
   - レート制限の実装
   - 適切な認証・認可
   - 入力バリデーション

3. エラーハンドリング
   - セキュリティに関わるエラーのロギング
   - センシティブ情報の非表示

### 7.3 フロントエンドセキュリティ

1. ウォレット連携
   - 安全なウォレット接続
   - トランザクションパラメータの検証

2. 入力検証
   - ユーザー入力のバリデーション
   - XSS対策

3. 有効期限表示
   - 正確な残り時間計算
   - 期限切れ時の適切な処理

## 8. 運用ガイドライン

### 8.1 モニタリング設定

1. コントラクトイベントの監視
   - RewardRegistered/RewardClaimedイベントのモニタリング
   - 異常パターンの検出

2. システムメトリクス
   - API応答時間
   - データベース接続状態
   - イベント処理遅延

3. アラート設定
   - リトライキューの増大
   - 署名失敗の頻発
   - ノード接続問題

### 8.2 障害対応手順

1. ノード接続障害時
   - フォールバックノードへの切り替え
   - 一時的なサービス縮退モードへの移行

2. データベース障害時
   - バックアップからの復旧
   - リトライキューからの再処理

3. コントラクト関連問題
   - コントラクトバグの場合のアップグレード手順
   - 緊急時の一時停止手順

### 8.3 バックアップ戦略

1. データベースバックアップ
   - 定期的な完全バックアップ
   - トランザクションログのバックアップ

2. 署名鍵のバックアップ
   - 安全な鍵バックアップ手順
   - 復旧テスト手順

3. デプロイ情報のバックアップ
   - コントラクトアドレス
   - ABIインターフェース
   - デプロイメント設定

### 8.4 スケーリング戦略

1. データベーススケーリング
   - シャーディング戦略
   - インデックス最適化

2. APIスケーリング
   - 水平スケーリング
   - キャッシュ戦略

3. イベント処理スケーリング
   - 並列処理
   - イベントバッファリング

## まとめ

本実装指示書に従って各コンポーネントを構築し、適切に連携させることで、安全で効率的な報酬配布システムを実現できます。開発中に疑問や課題が発生した場合は、チームリーダーに相談し、必要に応じて設計の見直しを行ってください。

各環境（開発・テスト・本番）でのデプロイを慎重に行い、十分なテストを実施した後にユーザーに公開してください。また、セキュリティ監査も実施し、システムの安全性を確保してください。