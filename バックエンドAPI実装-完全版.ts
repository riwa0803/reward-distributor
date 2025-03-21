import { ethers } from 'ethers';
import { db } from './database';
import { RewardDistributorABI, AirdropRegistryABI } from './abis';
import { 
  Airdrop, 
  Asset, 
  Reward, 
  RewardStatus, 
  ChainConfig, 
  AirdropEventType, 
  ContractType 
} from './types';

/**
 * Airdropの登録
 * @param chainId チェーンID
 * @param airdropData Airdrop情報
 * @returns 登録されたAirdrop情報
 */
export async function registerAirdrop(
  chainId: number,
  airdropData: {
    onchainId: number;
    name: string;
    description?: string;
    imageUrl?: string;
    startDate: Date;
    endDate: Date;
    isActive?: boolean;
    creatorAddress: string;
  }
): Promise<Airdrop> {
  // バリデーション
  if (!airdropData.name || !airdropData.startDate || !airdropData.endDate || !airdropData.creatorAddress) {
    throw new Error('Missing required fields');
  }
  
  if (airdropData.startDate > airdropData.endDate) {
    throw new Error('End date must be after start date');
  }
  
  // トランザクションでの一括処理
  const airdrop = await db.transaction(async (trx) => {
    const [airdropId] = await trx('airdrops').insert({
      onchain_id: airdropData.onchainId,
      name: airdropData.name,
      description: airdropData.description || '',
      image_url: airdropData.imageUrl || '',
      start_date: airdropData.startDate,
      end_date: airdropData.endDate,
      is_active: airdropData.isActive ?? true,
      creator_address: airdropData.creatorAddress.toLowerCase(),
      created_at: new Date(),
      updated_at: new Date()
    }
    
    // イベントログの記録
    await trx('airdrop_event_logs').insert({
      chain_id: eventData.chainId,
      airdrop_id: eventData.airdropId,
      event_type: eventData.eventType,
      transaction_hash: eventData.transactionHash,
      block_number: eventData.blockNumber,
      creator_address: eventData.creatorAddress.toLowerCase(),
      start_date: eventData.startDate,
      end_date: eventData.endDate,
      is_active: eventData.isActive,
      created_at: new Date()
    });
  });
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
  rewardId: number;
  airdropId: number;
  recipient: string;
  amount: number;
  tokenId?: number;
}>): Promise<Reward[]> {
  const registeredRewards = await db.transaction(async (trx) => {
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

    const insertedRewardIds = await trx('rewards').insert(rewardsToInsert).returning('id');

    // 挿入された報酬の詳細を取得
    const insertedRewards = await trx('rewards')
      .whereIn('id', insertedRewardIds)
      .select('*');

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
  });

  return registeredRewards;
}

/**
 * ユーザーの報酬一覧を取得
 * @param userAddress ユーザーアドレス
 * @param page ページ番号
 * @param limit 1ページあたりの件数
 * @returns 報酬一覧とページング情報
 */
export async function getUserRewards(
  userAddress: string,
  page: number = 1,
  limit: number = 20
): Promise<{
  rewards: Reward[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  }
}> {
  const offset = (page - 1) * limit;
  
  // 報酬総数の取得
  const [{ count }] = await db('rewards')
    .where('user_address', userAddress.toLowerCase())
    .count('id as count');
  
  // 報酬データの取得
  const rewards = await db('rewards')
    .join('airdrops', 'rewards.airdrop_id', 'airdrops.id')
    .where('rewards.user_address', userAddress.toLowerCase())
    .select(
      'rewards.*',
      'airdrops.onchain_id as airdrop_onchain_id',
      'airdrops.name as airdrop_name',
      'airdrops.is_active as airdrop_is_active'
    )
    .orderBy('rewards.created_at', 'desc')
    .offset(offset)
    .limit(limit);
  
  // ページング情報の計算
  const total = parseInt(count as string);
  const pages = Math.ceil(total / limit);
  
  return {
    rewards: rewards.map(r => ({
      id: r.id,
      chainId: r.chain_id,
      assetId: r.asset_id,
      rewardId: r.reward_id,
      airdropId: r.airdrop_id,
      airdropOnchainId: r.airdrop_onchain_id,
      airdropName: r.airdrop_name,
      airdropIsActive: r.airdrop_is_active,
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
    })),
    pagination: {
      total,
      page,
      limit,
      pages
    }
  };
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
    // Airdropの存在確認と取得
    const airdrop = await trx('airdrops')
      .where('onchain_id', eventData.airdropId)
      .first();
    
    if (!airdrop) {
      throw new Error(`Airdrop with onchain ID ${eventData.airdropId} not found`);
    }
    
    // 既存の報酬レコードを検索
    let reward = await trx('rewards')
      .where({
        chain_id: eventData.chainId,
        asset_id: eventData.assetId,
        reward_id: eventData.rewardId
      })
      .first();

    if (!reward) {
      // 報酬レコードが存在しない場合は新規作成
      const [newRewardId] = await trx('rewards').insert({
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
 * 失敗したイベントの再試行キューへの追加
 * @param eventData 失敗したイベントデータ
 */
export async function addToRetryQueue(eventData: {
  chainId: number;
  contractType: ContractType;
  eventName: string;
  params: any;
  transactionHash: string;
  blockNumber: number;
  error: string
}): Promise<void> {
  await db('event_retry_queue').insert({
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

/**
 * リトライキューの処理
 */
export async function processRetryQueue(): Promise<void> {
  const retryItems = await db('event_retry_queue')
    .where('next_retry_at', '<=', new Date())
    .limit(100); // バッチサイズを制限

  for (const item of retryItems) {
    try {
      const params = JSON.parse(item.params);
      
      // コントラクトタイプに応じたイベント処理
      if (item.contract_type === ContractType.AIRDROP_REGISTRY) {
        await processAirdropEvent({
          ...params,
          transactionHash: item.transaction_hash,
          blockNumber: item.block_number
        });
      } else if (item.contract_type === ContractType.REWARD_DISTRIBUTOR) {
        await processRewardEvent({
          ...params,
          transactionHash: item.transaction_hash,
          blockNumber: item.block_number
        });
      }
      
      // 成功した場合はリトライキューから削除
      await db('event_retry_queue')
        .where('id', item.id)
        .del();
    } catch (error) {
      // 再試行回数と次回試行時間を更新
      const newRetryCount = item.retry_count + 1;
      const backoffTime = Math.pow(2, newRetryCount) * 60000; // 指数バックオフ

      await db('event_retry_queue')
        .where('id', item.id)
        .update({
          retry_count: newRetryCount,
          next_retry_at: new Date(Date.now() + backoffTime),
          last_error: (error as Error).toString(),
          updated_at: new Date()
        });
    }
  }
});
    
    const createdAirdrop = await trx('airdrops')
      .where('id', airdropId)
      .first();
    
    // Airdropイベントログの記録
    await trx('airdrop_event_logs').insert({
      chain_id: chainId,
      airdrop_id: airdropData.onchainId,
      event_type: AirdropEventType.CREATED,
      transaction_hash: '', // オンチェーンイベントから取得する場合はここに入れる
      block_number: 0, // オンチェーンイベントから取得する場合はここに入れる
      creator_address: airdropData.creatorAddress.toLowerCase(),
      start_date: airdropData.startDate,
      end_date: airdropData.endDate,
      is_active: airdropData.isActive ?? true,
      created_at: new Date()
    });
    
    return {
      id: createdAirdrop.id,
      onchainId: createdAirdrop.onchain_id,
      name: createdAirdrop.name,
      description: createdAirdrop.description,
      imageUrl: createdAirdrop.image_url,
      startDate: new Date(createdAirdrop.start_date),
      endDate: new Date(createdAirdrop.end_date),
      isActive: createdAirdrop.is_active,
      creatorAddress: createdAirdrop.creator_address,
      createdAt: new Date(createdAirdrop.created_at),
      updatedAt: new Date(createdAirdrop.updated_at)
    };
  });
  
  return airdrop;
}

/**
 * Airdrop期間の更新
 * @param chainId チェーンID
 * @param onchainId オンチェーンAirdropID
 * @param startDate 新しい開始日時
 * @param endDate 新しい終了日時
 * @param updaterAddress 更新者アドレス
 */
export async function updateAirdropPeriod(
  chainId: number,
  onchainId: number,
  startDate: Date,
  endDate: Date,
  updaterAddress: string
): Promise<Airdrop> {
  if (startDate >= endDate) {
    throw new Error('End date must be after start date');
  }
  
  const airdrop = await db.transaction(async (trx) => {
    // Airdropの更新
    const [updated] = await trx('airdrops')
      .where('onchain_id', onchainId)
      .update({
        start_date: startDate,
        end_date: endDate,
        updated_at: new Date()
      });
    
    if (!updated) {
      throw new Error(`Airdrop with onchain ID ${onchainId} not found`);
    }
    
    // イベントログの記録
    await trx('airdrop_event_logs').insert({
      chain_id: chainId,
      airdrop_id: onchainId,
      event_type: AirdropEventType.UPDATED,
      transaction_hash: '', // オンチェーンイベントから取得する場合はここに入れる
      block_number: 0, // オンチェーンイベントから取得する場合はここに入れる
      creator_address: updaterAddress.toLowerCase(),
      start_date: startDate,
      end_date: endDate,
      created_at: new Date()
    });
    
    const updatedAirdrop = await trx('airdrops')
      .where('onchain_id', onchainId)
      .first();
    
    return {
      id: updatedAirdrop.id,
      onchainId: updatedAirdrop.onchain_id,
      name: updatedAirdrop.name,
      description: updatedAirdrop.description,
      imageUrl: updatedAirdrop.image_url,
      startDate: new Date(updatedAirdrop.start_date),
      endDate: new Date(updatedAirdrop.end_date),
      isActive: updatedAirdrop.is_active,
      creatorAddress: updatedAirdrop.creator_address,
      createdAt: new Date(updatedAirdrop.created_at),
      updatedAt: new Date(updatedAirdrop.updated_at)
    };
  });
  
  return airdrop;
}

/**
 * Airdropステータスの更新
 * @param chainId チェーンID
 * @param onchainId オンチェーンAirdropID
 * @param isActive アクティブ状態
 * @param updaterAddress 更新者アドレス
 */
export async function updateAirdropStatus(
  chainId: number,
  onchainId: number,
  isActive: boolean,
  updaterAddress: string
): Promise<Airdrop> {
  const airdrop = await db.transaction(async (trx) => {
    // Airdropの更新
    const [updated] = await trx('airdrops')
      .where('onchain_id', onchainId)
      .update({
        is_active: isActive,
        updated_at: new Date()
      });
    
    if (!updated) {
      throw new Error(`Airdrop with onchain ID ${onchainId} not found`);
    }
    
    // イベントログの記録
    await trx('airdrop_event_logs').insert({
      chain_id: chainId,
      airdrop_id: onchainId,
      event_type: isActive ? AirdropEventType.UPDATED : AirdropEventType.DISABLED,
      transaction_hash: '', // オンチェーンイベントから取得する場合はここに入れる
      block_number: 0, // オンチェーンイベントから取得する場合はここに入れる
      creator_address: updaterAddress.toLowerCase(),
      is_active: isActive,
      created_at: new Date()
    });
    
    const updatedAirdrop = await trx('airdrops')
      .where('onchain_id', onchainId)
      .first();
    
    return {
      id: updatedAirdrop.id,
      onchainId: updatedAirdrop.onchain_id,
      name: updatedAirdrop.name,
      description: updatedAirdrop.description,
      imageUrl: updatedAirdrop.image_url,
      startDate: new Date(updatedAirdrop.start_date),
      endDate: new Date(updatedAirdrop.end_date),
      isActive: updatedAirdrop.is_active,
      creatorAddress: updatedAirdrop.creator_address,
      createdAt: new Date(updatedAirdrop.created_at),
      updatedAt: new Date(updatedAirdrop.updated_at)
    };
  });
  
  return airdrop;
}

/**
 * オンチェーンのAirdropイベントを処理
 * @param eventData イベントデータ
 */
export async function processAirdropEvent(eventData: {
  chainId: number;
  eventType: AirdropEventType;
  airdropId: number;
  startDate?: Date;
  endDate?: Date;
  isActive?: boolean;
  creatorAddress: string;
  transactionHash: string;
  blockNumber: number;
}): Promise<void> {
  // トランザクション内で処理を実行
  await db.transaction(async (trx) => {
    // Airdropの存在確認
    const existingAirdrop = await trx('airdrops')
      .where('onchain_id', eventData.airdropId)
      .first();
    
    if (eventData.eventType === AirdropEventType.CREATED) {
      // 新規Airdropの場合
      if (!existingAirdrop) {
        await trx('airdrops').insert({
          onchain_id: eventData.airdropId,
          name: `Airdrop #${eventData.airdropId}`, // オンチェーンにはnameがない場合はデフォルト名
          description: '',
          start_date: eventData.startDate,
          end_date: eventData.endDate,
          is_active: eventData.isActive ?? true,
          creator_address: eventData.creatorAddress.toLowerCase(),
          created_at: new Date(),
          updated_at: new Date()
        });
      } else {
        // すでに存在している場合は更新
        await trx('airdrops')
          .where('onchain_id', eventData.airdropId)
          .update({
            start_date: eventData.startDate,
            end_date: eventData.endDate,
            is_active: eventData.isActive ?? true,
            updated_at: new Date()
          });
      }
    } else if (eventData.eventType === AirdropEventType.UPDATED || eventData.eventType === AirdropEventType.EXTENDED) {
      // Airdrop期間またはステータスの更新
      if (existingAirdrop) {
        const updateData: any = {
          updated_at: new Date()
        };
        
        if (eventData.startDate) updateData.start_date = eventData.startDate;
        if (eventData.endDate) updateData.end_date = eventData.endDate;
        if (eventData.isActive !== undefined) updateData.is_active = eventData.isActive;
        
        await trx('airdrops')
          .where('onchain_id', eventData.airdropId)
          .update(updateData);
      }
    } else if (eventData.eventType === AirdropEventType.DISABLED) {
      // Airdropの無効化
      if (existingAirdrop) {
        await trx('airdrops')
          .where('onchain_id', eventData.airdropId)
          .update({
            is_active: false,
            updated_at: new Date()
          });
      }
    }
      