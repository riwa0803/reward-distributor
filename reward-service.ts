import { ethers } from 'ethers';
import { Knex } from 'knex';
import { 
  Reward, 
  RewardStatus, 
  AirdropEventType, 
  ContractType 
} from '../types';
import { TransactionManager, Transactional, TransactionalWithRetry } from '../utils/transaction-manager';
import { RewardDistributorABI, AirdropRegistryABI } from '../abis';
import { getChainConfig } from '../utils/chain-config';
import { logger } from '../utils/logger';

/**
 * 報酬管理のためのサービスクラス
 * トランザクション安全性を強化した実装
 */
export class RewardService {
  /**
   * 複数の報酬を一括登録（トランザクション保証付き）
   */
  @TransactionalWithRetry({
    maxRetries: 3,
    isolationLevel: 'serializable'
  })
  async registerRewardBatch(
    rewards: Array<{
      chainId: number;
      assetId: number;
      rewardId: number;
      airdropId: number;
      recipient: string;
      amount: number;
      tokenId?: number;
    }>,
    trx?: Knex.Transaction
  ): Promise<Reward[]> {
    try {
      // トランザクションが渡されていない場合は新規に作成
      const transaction = trx || await TransactionManager.executeInTransaction(async (t) => t);
      
      // Airdropの存在確認 (一括でチェック)
      const airdropIds = [...new Set(rewards.map(r => r.airdropId))];
      const existingAirdrops = await transaction('airdrops')
        .whereIn('id', airdropIds)
        .select('id');
      
      const foundAirdropIds = existingAirdrops.map(a => a.id);
      const missingAirdropIds = airdropIds.filter(id => !foundAirdropIds.includes(id));
      
      if (missingAirdropIds.length > 0) {
        throw new Error(`Airdrops with IDs ${missingAirdropIds.join(', ')} do not exist`);
      }
      
      // 重複チェック
      const rewardIdentifiers = rewards.map(r => ({
        chain_id: r.chainId,
        asset_id: r.assetId,
        reward_id: r.rewardId
      }));
      
      // 同時挿入を防ぐためのロック取得 (Postgresの場合)
      await transaction.raw('SELECT pg_advisory_xact_lock(?)', [
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes(JSON.stringify(rewardIdentifiers)))
      ]);
      
      // 既存の報酬をチェック
      const existingRewards = await transaction('rewards')
        .where(builder => {
          rewardIdentifiers.forEach(identifier => {
            builder.orWhere(identifier);
          });
        })
        .select('chain_id', 'asset_id', 'reward_id');
      
      if (existingRewards.length > 0) {
        const duplicates = existingRewards.map(r => 
          `(chainId: ${r.chain_id}, assetId: ${r.asset_id}, rewardId: ${r.reward_id})`
        );
        throw new Error(`Some rewards already exist: ${duplicates.join(', ')}`);
      }
      
      // 報酬データをバッチで挿入
      const rewardsToInsert = rewards.map(reward => ({
        chain_id: reward.chainId,
        asset_id: reward.assetId,
        reward_id: reward.rewardId,
        airdrop_id: reward.airdropId,
        user_address: reward.recipient.toLowerCase(),
        amount: reward.amount,
        token_id: reward.tokenId,
        status: RewardStatus.PENDING,
        created_at: new Date(),
        updated_at: new Date()
      }));
      
      // バッチ挿入 (より効率的)
      const insertedIds = await transaction('rewards')
        .insert(rewardsToInsert)
        .returning('id');
      
      // 挿入された報酬を取得
      const insertedRewards = await transaction('rewards')
        .whereIn('id', insertedIds)
        .select('*');
      
      // ログの記録
      await transaction('operation_logs').insert({
        operation_type: 'REWARD_BATCH_REGISTER',
        data: JSON.stringify({ count: insertedRewards.length }),
        created_at: new Date()
      });
      
      // 結果をマッピング
      return insertedRewards.map(r => ({
        id: r.id,
        chainId: r.chain_id,
        assetId: r.asset_id,
        rewardId: r.reward_id,
        airdropId: r.airdrop_id,
        userAddress: r.user_address,
        amount: r.amount,
        tokenId: r.token_id,
        status: r.status,
        signature: r.signature,
        signatureTimestamp: r.signature_timestamp,
        signatureExpiresAt: r.signature_expires_at ? new Date(r.signature_expires_at) : undefined,
        transactionHash: r.transaction_hash,
        blockNumber: r.block_number,
        claimedAt: r.claimed_at ? new Date(r.claimed_at) : undefined,
        onchainCommitment: r.onchain_commitment,
        createdAt: new Date(r.created_at),
        updatedAt: new Date(r.updated_at)
      }));
    } catch (error) {
      // エラーロギングを強化
      logger.error('Failed to register reward batch', {
        rewardCount: rewards.length,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // エラーを再スロー
      throw error;
    }
  }

  /**
   * 署名生成と期限設定（安全なトランザクション処理）
   */
  @Transactional('repeatable read')
  async prepareRewardClaim(
    chainId: number,
    assetId: number,
    rewardId: number,
    airdropId: number,
    userAddress: string,
    trx?: Knex.Transaction
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
    try {
      // トランザクションが渡されていない場合は新規に作成
      const transaction = trx || await TransactionManager.executeInTransaction(async (t) => t);
      
      // ロックを取得して他の操作を待機
      const lockKey = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(`${chainId}-${assetId}-${rewardId}`)
      );
      await transaction.raw('SELECT pg_advisory_xact_lock(?)', [lockKey]);
      
      // 報酬の存在確認
      const reward = await transaction('rewards')
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
      
      // Airdropの有効性をチェック
      const airdrop = await transaction('airdrops')
        .where({ id: reward.airdrop_id })
        .first();
      
      if (!airdrop || !airdrop.is_active) {
        throw new Error('Associated Airdrop is not active');
      }
      
      const now = new Date();
      if (now < new Date(airdrop.start_date) || now > new Date(airdrop.end_date)) {
        throw new Error('Airdrop is not currently active (outside date range)');
      }
      
      // チェーン設定の取得
      const chainConfig = getChainConfig(chainId);
      
      // AirdropRegistryでオンチェーン状態を確認
      const airdropRegistryProvider = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrl);
      const airdropRegistry = new ethers.Contract(
        chainConfig.airdropRegistryAddress,
        AirdropRegistryABI,
        airdropRegistryProvider
      );
      
      // オンチェーンのAirdrop有効性確認
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
        // トランザクション内でステータス更新
        await transaction('rewards')
          .where({
            chain_id: chainId,
            asset_id: assetId,
            reward_id: rewardId
          })
          .update({
            status: RewardStatus.CLAIMED,
            updated_at: new Date()
          });
        
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
      await transaction('rewards')
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
      
      // 署名履歴の記録
      await transaction('signature_logs').insert({
        chain_id: chainId,
        asset_id: assetId,
        reward_id: rewardId,
        user_address: userAddress.toLowerCase(),
        signature: signature,
        timestamp: timestamp,
        expires_at: expiresAt,
        created_at: new Date()
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
    } catch (error) {
      // 詳細なエラー情報をログに記録
      logger.error('Failed to prepare reward claim', {
        chainId,
        assetId,
        rewardId,
        airdropId,
        userAddress,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // エラーを再スロー
      throw error;
    }
  }

  /**
   * イベント処理（失敗時のリトライキュー対応）
   */
  @TransactionalWithRetry({
    maxRetries: 5,
    initialDelay: 500,
    backoffFactor: 1.5
  })
  async processRewardEvent(
    eventData: {
      chainId: number;
      assetId: number;
      airdropId: number;
      rewardId: number;
      recipient: string;
      amount: number;
      tokenId?: number;
      transactionHash: string;
      blockNumber: number;
    },
    trx?: Knex.Transaction
  ): Promise<void> {
    try {
      // トランザクションが渡されていない場合は新規に作成
      const transaction = trx || await TransactionManager.executeInTransaction(async (t) => t);
      
      // 既に処理済みかチェック (冪等性確保)
      const existingLog = await transaction('event_processed_logs')
        .where({
          transaction_hash: eventData.transactionHash,
          event_type: 'REWARD_REGISTERED',
          asset_id: eventData.assetId,
          reward_id: eventData.rewardId
        })
        .first();
      
      if (existingLog) {
        logger.info('Event already processed, skipping', {
          transactionHash: eventData.transactionHash,
          assetId: eventData.assetId,
          rewardId: eventData.rewardId
        });
        return;
      }
      
      // Airdropの存在確認と取得
      const airdrop = await transaction('airdrops')
        .where('onchain_id', eventData.airdropId)
        .first();
      
      if (!airdrop) {
        throw new Error(`Airdrop with onchain ID ${eventData.airdropId} not found`);
      }
      
      // 既存の報酬レコードを検索
      let reward = await transaction('rewards')
        .where({
          chain_id: eventData.chainId,
          asset_id: eventData.assetId,
          reward_id: eventData.rewardId
        })
        .first();

      // トランザクションハッシュが既に登録されているか確認
      let isNewTransaction = true;
      if (reward && reward.transaction_hash === eventData.transactionHash) {
        isNewTransaction = false;
      }

      if (!reward) {
        // 報酬レコードが存在しない場合は新規作成
        const [newRewardId] = await transaction('rewards').insert({
          chain_id: eventData.chainId,
          asset_id: eventData.assetId,
          airdrop_id: airdrop.id,
          reward_id: eventData.rewardId,
          user_address: eventData.recipient.toLowerCase(),
          amount: eventData.amount,
          token_id: eventData.tokenId,
          status: RewardStatus.PENDING,
          transaction_hash: eventData.transactionHash,
          block_number: eventData.blockNumber,
          created_at: new Date(),
          updated_at: new Date()
        });

        reward = await transaction('rewards').where('id', newRewardId).first();
      } else if (isNewTransaction) {
        // 既存のレコードがある場合は更新 (新規トランザクションの場合のみ)
        await transaction('rewards')
          .where('id', reward.id)
          .update({
            transaction_hash: eventData.transactionHash,
            block_number: eventData.blockNumber,
            updated_at: new Date()
          });
      }

      // イベントログの記録
      await transaction('reward_event_logs').insert({
        chain_id: eventData.chainId,
        asset_id: eventData.assetId,
        reward_id: eventData.rewardId,
        airdrop_id: eventData.airdropId,
        recipient: eventData.recipient.toLowerCase(),
        amount: eventData.amount,
        token_id: eventData.tokenId,
        transaction_hash: eventData.transactionHash,
        block_number: eventData.blockNumber,
        created_at: new Date()
      });
      
      // 処理済みマーク
      await transaction('event_processed_logs').insert({
        transaction_hash: eventData.transactionHash,
        block_number: eventData.blockNumber,
        event_type: 'REWARD_REGISTERED',
        asset_id: eventData.assetId,
        reward_id: eventData.rewardId,
        processed_at: new Date()
      });
      
    } catch (error) {
      // 詳細なエラー情報をログに記録
      logger.error('Failed to process reward event', {
        eventData,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // リトライキューに追加
      await this.addToRetryQueue({
        chainId: eventData.chainId,
        contractType: ContractType.REWARD_DISTRIBUTOR,
        eventName: 'RewardRegistered',
        params: { 
          assetId: eventData.assetId, 
          airdropId: eventData.airdropId,
          rewardId: eventData.rewardId,
          recipient: eventData.recipient,
          amount: eventData.amount,
          tokenId: eventData.tokenId
        },
        transactionHash: eventData.transactionHash,
        blockNumber: eventData.blockNumber,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // エラーを再スロー
      throw error;
    }
  }

  /**
   * リトライキューへの追加
   */
  private async addToRetryQueue(eventData: {
    chainId: number;
    contractType: ContractType;
    eventName: string;
    params: any;
    transactionHash: string;
    blockNumber: number;
    error: string
  }): Promise<void> {
    return TransactionManager.executeInTransaction(async (trx) => {
      // 既に同じイベントがキューにあるか確認
      const existingEntry = await trx('event_retry_queue')
        .where({
          transaction_hash: eventData.transactionHash,
          event_name: eventData.eventName
        })
        .first();
      
      if (existingEntry) {
        // 既存エントリーを更新
        await trx('event_retry_queue')
          .where('id', existingEntry.id)
          .update({
            retry_count: existingEntry.retry_count + 1,
            next_retry_at: new Date(Date.now() + Math.pow(2, existingEntry.retry_count + 1) * 60000),
            last_error: eventData.error,
            updated_at: new Date()
          });
      } else {
        // 新規エントリー追加
        await trx('event_retry_queue').insert({
          chain_id: eventData.chainId,
          contract_type: eventData.contractType,
          event_name: eventData.eventName,
          params: JSON.stringify(eventData.params),
          transaction_hash: eventData.transactionHash,
          block_number: eventData.blockNumber,
          retry_count: 0,
          next_retry_at: new Date(Date.now() + 60000), // 1分後に最初の再試行
          last_error: eventData.error,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    });
  }
}