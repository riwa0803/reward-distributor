# 報酬配布システム - README

## システム概要

報酬配布システムは、複数のブロックチェーン上でトークン報酬（ERC20/ERC721/ERC1155）をユーザーに配布するためのシステムです。アップグレード可能なプロキシパターンを採用し、AirdropIDとオンチェーンコミットメントによるセキュリティを強化しています。また、署名有効期限機能を追加して、より安全な報酬請求プロセスを実現しています。

### 主な機能

- 複数チェーン対応（クロスチェーン報酬配布）
- 複数種類のトークン対応（ERC20/ERC721/ERC1155）
- アップグレード可能なスマートコントラクト
- Airdropごとのグループ化と管理
- オンチェーンコミットメントによるセキュリティ強化
- 署名有効期限によるセキュリティ強化
- リトライメカニズムによる耐障害性
- バッチ処理によるガス最適化

### アーキテクチャ

システムは以下のコンポーネントで構成されています：

![システムアーキテクチャ図](./docs/images/architecture.png)

1. **スマートコントラクト**
   - `AirdropRegistryProxy`: Airdrop情報を管理するプロキシ
   - `AirdropRegistry`: Airdrop管理機能の実装コントラクト
   - `RewardDistributorProxy`: 報酬配布機能を委譲するプロキシ
   - `RewardDistributorProxyAdmin`: プロキシ管理用コントラクト
   - `RewardDistributor`: 報酬配布機能の実装コントラクト

2. **バックエンド**
   - データモデル: Airdrop、Asset、Reward等の構造定義
   - API実装: ブロックチェーンとの連携、署名生成等
   - イベントリスナー: コントラクトイベントの監視と処理
   - リトライメカニズム: 障害時の再処理機能

3. **フロントエンド**
   - 報酬表示コンポーネント
   - 報酬請求コンポーネント
   - 署名有効期限の視覚的表示
   - バッチ請求機能

## クイックスタート

### 前提条件
- Node.js >= 16.x
- PostgreSQL >= 13
- MetaMask または互換性のあるウォレット

### インストール

```bash
# リポジトリのクローン
git clone https://github.com/your-org/reward-distribution-system.git
cd reward-distribution-system

# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集して必要な設定を行う

# データベースのセットアップ
npm run db:migrate

# 開発サーバーの起動
npm run dev
```

### コントラクトのデプロイ

```bash
# デプロイスクリプトの実行
export VERIFIER_ADDRESS=0xYourVerifierAddressHere
npx hardhat run scripts/deploy.ts --network goerli
```

詳細な手順については、[エンジニア向け実装指示書](./docs/implementation-guide.md)を参照してください。

## 更新点

本システムは、前回の実装から以下の点を改善しています：

1. **Airdrop管理のコントラクト分離**
   - Airdrop情報を専用コントラクトで管理
   - アップグレード時のデータ永続性を強化
   - より柔軟なAirdrop管理を実現

2. **明確な権限管理**
   - システム管理者、報酬提供者、Airdrop作成者の権限区分
   - 権限に応じた操作制限
   - オペレーターロールによる運用管理の効率化

3. **AirdropIDの導入**
   - 複数の報酬をグループ化し、ユーザーへの表示を改善
   - バックエンドとブロックチェーン間の報酬連携を強化

4. **オンチェーンコミットメント**
   - 報酬パラメータのコミットメントをチェーン上に保存
   - 報酬請求時に検証することでセキュリティを強化

5. **署名有効期限機能**
   - 署名にタイムスタンプと有効期限を追加
   - 古い署名の悪用を防止する安全機能
   - フロントエンドでの視覚的な期限表示

6. **イベント処理の強化**
   - 見逃しイベント検出機能の追加
   - リトライメカニズムの改善

7. **緊急時対応機能**
   - Pausable機能による緊急時のシステム一時停止
   - 各コントラクトの個別制御が可能

8. **バッチ請求機能**
   - 複数の報酬を一括請求することでガスコストを削減
   - 最適化されたバッチ処理によるUX向上

## 使用例

### Airdropの作成
```typescript
// フロントエンドからのAirdrop作成例
const createAirdrop = async () => {
  const airdropData = {
    name: "テストAirdrop",
    description: "テスト用の報酬配布",
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30日後
    imageUrl: "https://example.com/airdrop.png"
  };
  
  const response = await fetch('/api/airdrops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(airdropData)
  });
  
  const result = await response.json();
  console.log('作成されたAirdrop:', result);
};
```

### 報酬の請求
```typescript
// ユーザー向けの報酬請求プロセス
const claimReward = async (chainId, assetId, rewardId, airdropId) => {
  // 1. 署名を取得
  const prepareResponse = await fetch('/api/rewards/prepare-claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainId, assetId, rewardId, airdropId, userAddress: walletAddress })
  });
  
  const claimData = await prepareResponse.json();
  
  // 2. コントラクトを呼び出して報酬を請求
  const provider = new ethers.providers.Web3Provider(window.ethereum);
  const signer = provider.getSigner();
  const contract = new ethers.Contract(
    REWARD_DISTRIBUTOR_ADDRESS, 
    REWARD_DISTRIBUTOR_ABI, 
    signer
  );
  
  const tx = await contract.claimReward(
    claimData.chainId,
    claimData.assetId,
    claimData.rewardId,
    claimData.nonce,
    claimData.timestamp,
    claimData.signature,
    claimData.amount,
    claimData.tokenId
  );
  
  await tx.wait();
  console.log('報酬請求が完了しました');
};
```

## トラブルシューティング

### よくある問題

1. **署名の有効期限切れ**
   - 症状: 「Signature expired」エラーが表示される
   - 解決策: 「署名を再取得」ボタンをクリックして新しい署名を取得してください

2. **トランザクション失敗**
   - 症状: MetaMaskでトランザクションが失敗する
   - 解決策: ガス価格が適切か、ネットワークが混雑していないか確認してください

3. **報酬が表示されない**
   - 症状: 報酬リストが空
   - 解決策: ウォレットのアドレスが正しいか、対象のAirdropが有効期間内か確認してください

その他の問題については、[トラブルシューティングガイド](./docs/troubleshooting.md)を参照してください。

## ファイル構成

```
reward-distribution-system/
├── contracts/                      # スマートコントラクト
│   ├── AirdropRegistry.sol
│   ├── RewardDistributor.sol
│   ├── RewardDistributorProxy.sol
│   ├── RewardDistributorProxyAdmin.sol
│   └── interfaces/                 # インターフェース定義
├── scripts/                        # スクリプト
│   ├── deploy.ts                   # デプロイスクリプト
│   └── verify.ts                   # 検証スクリプト
├── test/                           # テスト
│   ├── contracts/                  # コントラクトテスト
│   ├── backend/                    # バックエンドテスト
│   └── integration/                # 統合テスト
├── backend/                        # バックエンド
│   ├── src/
│   │   ├── api/                    # API実装
│   │   ├── models/                 # データモデル
│   │   ├── services/               # サービス層
│   │   └── utils/                  # ユーティリティ
│   ├── scripts/                    # スクリプト
│   └── db/                         # データベース関連
│       ├── migrations/             # マイグレーション
│       └── seeds/                  # シードデータ
├── frontend/                       # フロントエンド
│   ├── src/
│   │   ├── components/             # UI コンポーネント
│   │   ├── pages/                  # ページ
│   │   ├── services/               # API連携
│   │   └── utils/                  # ユーティリティ
│   └── public/                     # 静的ファイル
├── docker/                         # Dockerファイル
│   ├── backend.Dockerfile
│   └── frontend.Dockerfile
└── docs/                           # ドキュメント
    ├── implementation-guide.md     # 実装指示書
    ├── api-docs.md                 # API仕様書
    ├── sequence-diagrams/          # シーケンス図
    └── troubleshooting.md          # トラブルシューティング
```

## 依存パッケージ

### スマートコントラクト
- OpenZeppelin Contracts ^4.8.0
- Hardhat ^2.14.0

### バックエンド
- Node.js >= 16.x
- TypeScript ^4.9.5
- Express ^4.18.2
- Ethers.js ^5.7.2
- Knex.js ^2.4.2
- PostgreSQL >= 13

### フロントエンド
- React ^18.2.0
- TypeScript ^4.9.5
- ethers.js ^5.7.2
- Ant Design ^5.3.0
- date-fns ^2.29.3

## 貢献

バグ報告や機能要望は、Issueを作成してください。プルリクエストも歓迎します。

## ライセンス

MIT License
