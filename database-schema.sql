-- Airdropテーブル
CREATE TABLE airdrops (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    image_url VARCHAR(255),
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- チェーン設定テーブル
CREATE TABLE chains (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL UNIQUE,
    chain_name VARCHAR(100) NOT NULL,
    rpc_url VARCHAR(255) NOT NULL,
    reward_contract_address VARCHAR(42) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- アセットテーブル
CREATE TABLE assets (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    asset_id INTEGER NOT NULL,
    token_address VARCHAR(42) NOT NULL,
    asset_type SMALLINT NOT NULL, -- 0: ERC20, 1: ERC721, 2: ERC1155
    provider_address VARCHAR(42) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(chain_id, asset_id)
);

-- 報酬テーブル（更新版 - 署名有効期限対応）
CREATE TABLE rewards (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    asset_id INTEGER NOT NULL,
    reward_id INTEGER NOT NULL,
    airdrop_id INTEGER NOT NULL, -- AirdropIDを追加
    user_address VARCHAR(42) NOT NULL,
    amount NUMERIC NOT NULL,
    token_id INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, CLAIMED, FAILED
    signature TEXT,
    signature_timestamp BIGINT, -- 署名生成時のUNIXタイムスタンプ（秒）
    signature_expires_at TIMESTAMP, -- 署名の有効期限
    transaction_hash VARCHAR(66),
    block_number INTEGER,
    claimed_at TIMESTAMP,
    onchain_commitment VARCHAR(66), -- オンチェーンコミットメント
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(chain_id, asset_id, reward_id),
    FOREIGN KEY (airdrop_id) REFERENCES airdrops(id)
);

-- 報酬請求ログテーブル
CREATE TABLE reward_claim_logs (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    asset_id INTEGER NOT NULL,
    reward_id INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 報酬更新リトライキュー
CREATE TABLE reward_update_retry_queue (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    asset_id INTEGER NOT NULL,
    reward_id INTEGER NOT NULL,
    user_address VARCHAR(42) NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    block_number INTEGER NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP NOT NULL,
    last_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ブロックスキャン履歴
CREATE TABLE block_scan_history (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL UNIQUE,
    last_scanned_block INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- システム設定テーブル
CREATE TABLE system_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(100) NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- インデックス
CREATE INDEX idx_rewards_user_address ON rewards(user_address);
CREATE INDEX idx_rewards_airdrop_id ON rewards(airdrop_id);
CREATE INDEX idx_rewards_status ON rewards(status);
CREATE INDEX idx_rewards_signature_expires_at ON rewards(signature_expires_at);
CREATE INDEX idx_reward_claim_logs_tx_hash ON reward_claim_logs(transaction_hash);
CREATE INDEX idx_retry_queue_next_retry ON reward_update_retry_queue(next_retry_at);