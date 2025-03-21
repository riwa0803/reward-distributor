import { ethers } from 'ethers';
import { db } from './database';
import { RewardDistributorABI, AirdropRegistryABI } from './abis';
import { getChainConfig } from './utils';
import { RewardStatus } from './types';

/**
 * 報酬請求の準備（署名生成）
 * @param chainId チェーンID
 * @param assetId アセットID
 * @param rewardId 報酬ID
 * @param airdropId AirdropID
 * @param userAddress ユーザーアドレス
 * @returns 署名データとパラメータ
 */
export async function prepareRewardClaim(
  chainId: number,
  assetId: number,
  rewardId: number,
  airdropId: number,
  userAddress: string
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
  // 報酬の存在確認
  const reward = await db('rewards')
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
  
  // チェーン設定の取得
  const chainConfig = getChainConfig(chainId);
  
  // Airdropの有効性をチェック
  const airdropRegistryProvider = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrl);
  const airdropRegistry = new ethers.Contract(
    chainConfig.airdropRegistryAddress,
    AirdropRegistryABI,
    airdropRegistryProvider
  );
  
  const [isAirdropValid, ] = await airdropRegistry.isAirdropValid(airdropId);
  if (!isAirdropValid) {
    throw new Error('Airdrop is not valid or has expired');
  }
  
  // RewardDistributorの参照
  const provider = new ethers.providers.JsonRpcProvider(chainConfig.rpcUrl);
  const contract = new ethers.Contract(
    chainConfig.rewardDistributorAddress,
    RewardDistributorABI,
    provider
  );
  
  // オンチェーンの請求状態を確認
  const isClaimed = await contract.isRewardClaimed(assetId, rewardId);
  if (isClaimed) {
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
  await db('rewards')
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
  
  // 請求情報を返却
  return {
    chainId,
    assetId,
    rewardId,
    airdropId,
    amount: reward.amount,
    tokenId: reward.token_id || 0,
    nonce: nonce.toNumber(),
    timestamp,
    signature,
    expiresAt
  };
}