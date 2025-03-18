import { ethers } from 'ethers';
import { db } from './database';
import { RewardDistributorABI } from './abis';
import { Airdrop, Asset, Reward, RewardStatus, ChainConfig } from './types';

/**
 * Airdropの登録
 * @param airdropData Airdrop情報
 * @returns 登録されたAirdrop情報
 */
export async function createAirdrop(airdropData: Omit<Airdrop, 'id' | 'createdAt' | 'updatedAt'>): Promise<Airdrop> {
  // バリデーション
  if (!airdropData.name || !airdropData.startDate || !airdropData.endDate) {
    throw new Error('Missing required fields');
  }
  
  if (airdropData.startDate > airdropData.endDate) {
    throw new Error('End date must be after start date');
  }
  
  // トランザクションでの一括処理
  const airdrop = await db.transaction(async (trx) => {
    const [airdropId] = await trx('airdrops').insert({
      name: airdropData.name,
      description: airdropData.description,
      image_url: airdropData.imageUrl,
      start_date: airdropData.startDate,
      end_date: airdropData.endDate,
      is_active: airdropData.isActive ?? true,
      created_at: new Date(),
      updated_at: new Date()
    });
    
    const createdAirdrop = await trx('airdrops')
      .where('id', airdropId)
      .first();
    
    return {
      id: createdAirdrop.id,
      name: createdAirdrop.name,
      description: createdAirdrop.description,
      imageUrl: createdAirdrop.image_url,
      startDate: new Date(createdAirdrop.start_date),
      endDate: new Date(createdAirdrop.end_date),
      isActive: createdAirdrop.is_active,
      createdAt: new Date(createdAirdrop.created_at),
      updatedAt: new Date(createdAirdrop.updated_at)
    };
  });
  
  return airdrop;
}

/**
 * アセットの登録
 * @param assetData Asset情報
 * @returns 登録されたAsset情報
 */
export async function registerAsset(assetData: Omit<Asset, 'isActive'> & { isActive?: boolean }): Promise<Asset> {
  // バリデーション
  if (!assetData.tokenAddress || !assetData.providerAddress) {
    throw new Error('Token address and provider address are required');
  }

  const asset = await db.transaction(async (trx) => {
    const [assetId] = await trx('assets').insert({
      chain_id: assetData.chainId,
      asset_id: assetData.assetId,
      token_address: assetData.tokenAddress,
      asset_type: assetData.assetType,
      provider_address: assetData.providerAddress,
      is_active: assetData.isActive ?? true,
      created_at: new Date(),
      updated_at: new Date()
    });

    const createdAsset = await trx('assets')
      .where('id', assetId)
      .first();

    return {
      chainId: createdAsset.chain_id,
      assetId: createdAsset.asset_id,
      tokenAddress: createdAsset.token_address,
      assetType: createdAsset.asset_type,
      providerAddress: createdAsset.provider_address,
      isActive: createdAsset.is_active
    };
  });

  return asset;
}

/**
 * 報酬のバッチ登録
 * @param rewards 登録する報酬のリスト
 * @returns 登録された報酬のリスト
 */
export async function registerRewardBatch(rewards: Array<{
  chainId: number;
  assetId: number;
  airdropId: number;
  recipient: string;
  amount: number;
  tokenId?: number;
}>): Promise<Reward[]> {
  const registeredRewards = await db.transaction(async (trx) => {
    const rewardsToInsert = rewards.map(reward => ({
      chain_id: reward.chainId,
      asset_id: reward.assetId,
      airdrop_id: reward.airdropId,
      user_address: reward.recipient.toLowerCase(),
      amount: reward.amount,
      token_id: reward.tokenId,
      status: RewardStatus.PENDING,
      created_at: new Date(),
      updated_at: new Date()
    }));

    const insertedRewardIds = await trx('rewards').insert(rewardsToInsert).returning('id');

    // 挿入された報酬の詳細を取得
    const insertedRewards = await trx('rewards')
      .whereIn('id', insertedRewardIds)
      .select('*');

    return insertedRewards.map(r => ({
      id: r.id,
      chainId: r.chain_id,
      assetId: r.asset_id,
      rewardId: r.reward_id, // データベースで生成される可能性がある
      airdropId: r.airdrop_id,
      userAddress: r.user_address,
      amount: r.amount,
      tokenId: r.token_id,
      status: r.status,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at)
    }));
  });

  return registeredRewards;
}

/**
 * オンチェーンの報酬イベントを処理
 * @param eventData イベントデータ
 */
export async function processRewardEvent(eventData: {
  chainId: number;
  assetId: number;
  airdropId: number;
  rewardId: number;
  recipient: string;
  amount: number;
  tokenId?: number;
  transactionHash: string;
  blockNumber: number;
}): Promise<void> {
  // トランザクション内で処理を実行
  await db.transaction(async (trx) => {
    // 既存の報酬レコードを検索または作成
    let reward = await trx('rewards')
      .where({
        chain_id: eventData.chainId,
        asset_id: eventData.assetId,
        user_address: eventData.recipient.toLowerCase(),
        reward_id: eventData.rewardId
      })
      .first();

    if (!reward) {
      // 報酬レコードが存在しない場合は新規作成
      const [newRewardId] = await trx('rewards').insert({
        chain_id: eventData.chainId,
        asset_id: eventData.assetId,
        airdrop_id: eventData.airdropId,
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

      reward = await trx('rewards').where('id', newRewardId).first();
    } else {
      // 既存のレコードがある場合は更新
      await trx('rewards')
        .where('id', reward.id)
        .update({
          transaction_hash: eventData.transactionHash,
          block_number: eventData.blockNumber,
          updated_at: new Date()
        });
    }

    // イベントログの記録
    await trx('reward_event_logs').insert({
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
  });
}

/**
 * 失敗した報酬イベントの再試行キューへの追加
 * @param eventData 失敗したイベントデータ
 */
export async function addToRetryQueue(eventData: {
  chainId: number;
  assetId: number;
  rewardId: number;
  recipient: string;
  error: string
}): Promise<void> {
  await db('reward_update_retry_queue').insert({
    chain_id: eventData.chainId,
    asset_id: eventData.assetId,
    reward_id: eventData.rewardId,
    user_address: eventData.recipient.toLowerCase(),
    retry_count: 0,
    next_retry_at: new Date(Date.now() + 60000), // 1分後に最初の再試行
    last_error: eventData.error,
    created_at: new Date(),
    updated_at: new Date()
  });
}

/**
 * リトライキューの処理
 */
export async function processRetryQueue(): Promise<void> {
  const retryItems = await db('reward_update_retry_queue')
    .where('next_retry_at', '<=', new Date())
    .limit(100); // バッチサイズを制限

  for (const item of retryItems) {
    try {
      // イベント再処理のロジック
      await processRewardEvent({
        chainId: item.chain_id,
        assetId: item.asset_id,
        rewardId: item.reward_id,
        recipient: item.user_address,
        amount: 0, // 追加情報が必要な場合は外部から取得
        transactionHash: '', // 必要に応じて補完
        blockNumber: 0
      });

      // 成功した場合はリトライキューから削除
      await db('reward_update_retry_queue')
        .where('id', item.id)
        .del();
    } catch (error) {
      // 再試行回数と次回試行時間を更新
      const newRetryCount = item.retry_count + 1;
      const backoffTime = Math.pow(2, newRetryCount) * 60000; // 指数バックオフ

      await db('reward_update_retry_queue')
        .where('id', item.id)
        .update({
          retry_count: newRetryCount,
          next_retry_at: new Date(Date.now() + backoffTime),
          last_error: error.toString(),
          updated_at: new Date()
        });
    }
  }
}

// その他のヘルパー関数や設定は前のバージョンと同様に保持