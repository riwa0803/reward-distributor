-- Airdropテーブル
CREATE TABLE airdrops (
    id SERIAL PRIMARY KEY,
    onchain_id INTEGER NOT NULL, -- オンチェーンのairdropId
    name VARCHAR(100) NOT NULL,
    description TEXT,
    image_url VARCHAR(255),
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    creator_address VARCHAR(42) NOT NULL, -- Airdrop作成者アドレス
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(onchain_id)
);

-- チェーン設定テーブル
CREATE TABLE chains (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL UNIQUE,
    chain_name VARCHAR(100) NOT NULL,
    rpc_url VARCHAR(255) NOT NULL,
    airdrop_registry_address VARCHAR(42) NOT NULL, -- AirdropRegistryのアドレス
    reward_distributor_address VARCHAR(42) NOT NULL, -- RewardDistributorのアドレス
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- オペレーターテーブル（新規）
CREATE TABLE operators (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    operator_address VARCHAR(42) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(chain_id, operator_address),
    FOREIGN KEY (chain_id) REFERENCES chains(chain_id) ON DELETE CASCADE
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

-- 報酬テーブル
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
    transaction_hash VARCHAR(66),
    block_number INTEGER,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMP NOT NULL,
    last_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Airdropイベントログテーブル（新規）
CREATE TABLE airdrop_event_logs (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    airdrop_id INTEGER NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- 'CREATED', 'UPDATED', 'EXTENDED', 'DISABLED'
    transaction_hash VARCHAR(66) NOT NULL,
    block_number INTEGER NOT NULL,
    creator_address VARCHAR(42),
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    is_active BOOLEAN,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ブロックスキャン履歴
CREATE TABLE block_scan_history (
    id SERIAL PRIMARY KEY,
    chain_id INTEGER NOT NULL,
    contract_type VARCHAR(30) NOT NULL, -- 'REWARD_DISTRIBUTOR', 'AIRDROP_REGISTRY'
    last_scanned_block INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(chain_id, contract_type)
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
CREATE INDEX idx_airdrops_creator_address ON airdrops(creator_address);
CREATE INDEX idx_airdrops_is_active ON airdrops(is_active);
CREATE INDEX idx_rewards_user_address ON rewards(user_address);
CREATE INDEX idx_rewards_airdrop_id ON rewards(airdrop_id);
CREATE INDEX idx_rewards_status ON rewards(status);
CREATE INDEX idx_rewards_signature_expires_at ON rewards(signature_expires_at);
CREATE INDEX idx_reward_claim_logs_tx_hash ON reward_claim_logs(transaction_hash);
CREATE INDEX idx_retry_queue_next_retry ON reward_update_retry_queue(next_retry_at);
CREATE INDEX idx_airdrop_event_logs_airdrop_id ON airdrop_event_logs(airdrop_id);
CREATE INDEX idx_airdrop_event_logs_tx_hash ON airdrop_event_logs(transaction_hash);