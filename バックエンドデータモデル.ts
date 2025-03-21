// TypeScript型定義

// Airdrop情報
interface Airdrop {
    id: number;                // 内部ID（自動採番）
    onchainId: number;         // オンチェーンID
    name: string;              // Airdrop名
    description: string;       // 説明
    imageUrl?: string;         // アイコン/画像URL
    startDate: Date;           // 開始日時
    endDate: Date;             // 終了日時
    isActive: boolean;         // アクティブ状態
    creatorAddress: string;    // 作成者アドレス
    createdAt: Date;           // 作成日時
    updatedAt: Date;           // 更新日時
}

// チェーン設定
interface ChainConfig {
    chainId: number;               // チェーンID
    chainName: string;             // チェーン名
    rpcUrl: string;                // RPC URL
    airdropRegistryAddress: string; // AirdropRegistryのアドレス
    rewardDistributorAddress: string; // RewardDistributorのアドレス
}

// オペレーター情報
interface Operator {
    chainId: number;           // チェーンID
    operatorAddress: string;   // オペレーターアドレス
    isActive: boolean;         // アクティブ状態
    createdAt: Date;           // 作成日時
    updatedAt: Date;           // 更新日時
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
    signatureTimestamp?: number; // 署名生成時のタイムスタンプ
    signatureExpiresAt?: Date; // 署名の有効期限
    transactionHash?: string; // クレームトランザクションハッシュ
    blockNumber?: number;     // ブロック番号
    claimedAt?: Date;         // クレーム日時
    onchainCommitment?: string; // オンチェーンコミットメント
    createdAt: Date;          // 作成日時
    updatedAt: Date;          // 更新日時
}

// Airdropイベントタイプ
enum AirdropEventType {
    CREATED = 'CREATED',
    UPDATED = 'UPDATED',
    EXTENDED = 'EXTENDED',
    DISABLED = 'DISABLED'
}

// Airdropイベントログ
interface AirdropEventLog {
    id: number;               // 内部ID（自動採番）
    chainId: number;          // チェーンID
    airdropId: number;        // AirdropID
    eventType: AirdropEventType; // イベントタイプ
    transactionHash: string;  // トランザクションハッシュ
    blockNumber: number;      // ブロック番号
    creatorAddress?: string;  // 作成者/更新者アドレス
    startDate?: Date;         // 開始日時（更新時）
    endDate?: Date;           // 終了日時（更新時）
    isActive?: boolean;       // アクティブ状態（更新時）
    createdAt: Date;          // 作成日時
}

// コントラクトタイプ
enum ContractType {
    REWARD_DISTRIBUTOR = 'REWARD_DISTRIBUTOR',
    AIRDROP_REGISTRY = 'AIRDROP_REGISTRY'
}

// ブロックスキャン履歴
interface BlockScanHistory {
    id: number;              // 内部ID（自動採番）
    chainId: number;         // チェーンID
    contractType: ContractType; // コントラクトタイプ
    lastScannedBlock: number; // 最後にスキャンしたブロック番号
    createdAt: Date;         // 作成日時
    updatedAt: Date;         // 更新日時
}

// イベントリトライキュー
interface EventRetryQueue {
    id: number;              // 内部ID（自動採番）
    chainId: number;         // チェーンID
    contractType: ContractType; // コントラクトタイプ
    eventName: string;       // イベント名
    params: string;          // イベントパラメータ（JSON文字列）
    transactionHash: string; // トランザクションハッシュ
    blockNumber: number;     // ブロック番号
    retryCount: number;      // 再試行回数
    nextRetryAt: Date;       // 次回再試行日時
    lastError: string;       // 最後のエラーメッセージ
    createdAt: Date;         // 作成日時
    updatedAt: Date;         // 更新日時
}