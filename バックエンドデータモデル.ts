// TypeScript型定義

// Airdrop情報
interface Airdrop {
    id: number;                // Airdrop識別子
    name: string;              // Airdrop名
    description: string;       // 説明
    imageUrl?: string;         // アイコン/画像URL
    startDate: Date;           // 開始日時
    endDate: Date;             // 終了日時
    isActive: boolean;         // アクティブ状態
    createdAt: Date;           // 作成日時
    updatedAt: Date;           // 更新日時
}

// チェーン設定
interface ChainConfig {
    chainId: number;           // チェーンID
    chainName: string;         // チェーン名
    rpcUrl: string;            // RPC URL
    rewardContractAddress: string; // 報酬コントラクトアドレス
}

// アセットタイプ列挙型
enum AssetType {
    ERC20 = 0,
    ERC721 = 1,
    ERC1155 = 2
}

// アセット情報
interface Asset {
    chainId: number;          // チェーンID
    assetId: number;          // コントラクトで登録されたアセットID
    tokenAddress: string;     // トークンコントラクトアドレス
    assetType: AssetType;     // アセットタイプ
    providerAddress: string;  // 報酬提供者アドレス
    isActive: boolean;        // アクティブ状態
}

// 報酬ステータス
enum RewardStatus {
    PENDING = 'PENDING',
    CLAIMED = 'CLAIMED',
    FAILED = 'FAILED'
}

// 報酬情報
interface Reward {
    id: number;               // 内部ID（自動採番）
    chainId: number;          // チェーンID
    assetId: number;          // アセットID
    rewardId: number;         // 報酬ID（コントラクト側で生成）
    airdropId: number;        // AirdropID（グループ化用）
    userAddress: string;      // ユーザーアドレス
    amount: number;           // 数量
    tokenId?: number;         // トークンID（ERC721/ERC1155用）
    status: RewardStatus;     // ステータス
    signature?: string;       // 生成された署名
    transactionHash?: string; // クレームトランザクションハッシュ
    blockNumber?: number;     // ブロック番号
    claimedAt?: Date;         // クレーム日時
    onchainCommitment?: string; // オンチェーンコミットメント
    createdAt: Date;          // 作成日時
    updatedAt: Date;          // 更新日時
}