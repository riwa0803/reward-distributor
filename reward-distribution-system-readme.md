# 報酬配布システム GitHub README

## 概要

このリポジトリは、ブロックチェーン上でトークン報酬を安全かつ効率的に配布するためのシステムを実装しています。
ERC20、ERC721、ERC1155といった様々なトークン規格に対応し、マルチチェーン環境での報酬配布をサポートします。

## 主な機能

- **マルチチェーン対応**: 複数のブロックチェーンネットワークでの報酬配布をサポート
- **複数トークン規格**: ERC20、ERC721、ERC1155規格のトークンに対応
- **アップグレード可能**: UUPSプロキシパターンを採用し、コントラクトの機能拡張が可能
- **安全な署名検証**: バックエンドによる署名とオンチェーンでの検証による二重のセキュリティ
- **Airdropグループ化**: 複数の報酬をAirdropとしてグループ化して管理
- **イベント監視**: ブロックチェーンイベントのリアルタイム監視と状態同期

## システムアーキテクチャ

本システムは以下のコンポーネントで構成されています：

1. **スマートコントラクト**:
   - `RewardDistributor.sol`: 報酬配布の中核となるコントラクト
   - `RewardDistributorProxy.sol`: アップグレード可能なプロキシコントラクト
   - `RewardDistributorProxyAdmin.sol`: プロキシ管理用コントラクト

2. **バックエンド**:
   - 報酬バッチ登録API
   - 署名生成サービス
   - イベントリスナー
   - クレーム処理API

3. **データベース**:
   - チェーン設定
   - アセット情報
   - 報酬データ
   - Airdrop情報

4. **フロントエンド**:
   - 報酬一覧表示
   - クレーム処理UI

## セットアップ手順

### 前提条件

- Node.js v16以上
- PostgreSQL 13以上
- Hardhat (スマートコントラクトデプロイ用)

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/yourusername/reward-distribution-system.git
cd reward-distribution-system

# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集して必要な設定を行う

# データベースの初期化
npm run db:init
```

### スマートコントラクトのデプロイ

```bash
# テストネットにデプロイ
npx hardhat run scripts/deploy.js --network testnet

# メインネットにデプロイ
npx hardhat run scripts/deploy.js --network mainnet
```

### バックエンドの起動

```bash
# 開発モード
npm run dev

# 本番モード
npm run build
npm start
```

## 使用方法

### 1. Airdropの作成

```javascript
const airdrop = await createAirdrop({
  name: "Summer Rewards",
  description: "Summer event rewards for active participants",
  startDate: new Date("2025-06-01"),
  endDate: new Date("2025-08-31"),
  isActive: true
});
```

### 2. アセットの登録

```javascript
// コントラクト上でアセットを登録
const assetId = await rewardDistributor.registerAsset(
  tokenAddress,
  AssetType.ERC20,
  providerAddress
);
```

### 3. 報酬の登録

```javascript
// コントラクト上で報酬を登録
const rewardId = await rewardDistributor.registerRewardWithAirdrop(
  assetId,
  airdropId,
  recipientAddress,
  amount,
  tokenId
);
```

### 4. 報酬のクレーム

```javascript
// バックエンドから署名データを取得
const claimData = await fetchClaimData(chainId, assetId, rewardId);

// ウォレットで報酬をクレーム
await rewardDistributor.claimReward(
  claimData.chainId,
  claimData.assetId,
  claimData.rewardId,
  claimData.nonce,
  claimData.signature,
  claimData.amount,
  claimData.tokenId
);
```

## 開発フロー

報酬設定からユーザー受取までの基本フローは以下の通りです：

1. Airdrop情報の登録
2. トークンアセットの登録
3. 報酬データの登録とコミットメント生成
4. ユーザーによる報酬情報の確認
5. 署名生成による報酬クレーム準備
6. ウォレットを使用した報酬の受取
7. イベント検知によるステータス更新

## セキュリティ考慮事項

- 署名用の秘密鍵は安全に管理し、環境変数やシークレット管理サービスを使用してください
- 本番環境では AWS KMS や Google Cloud KMS などのマネージドキーサービスの使用を推奨します
- 署名に有効期限を設定することも検討してください
- 過去の署名が長期間有効にならないよう対策を講じてください
- レート制限を実装して同一ユーザーからの過度なリクエストを制限してください
- すべての重要な操作の監査ログを記録してください

## テスト

```bash
# スマートコントラクトのテスト
npx hardhat test

# バックエンドのテスト
npm test
```

## ライセンス

MIT

## 貢献

プルリクエストや機能提案は大歓迎です。大きな変更を加える前には、まずissueを作成して議論してください。

---

© 2025 Your Organization
