import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Button, Card, Typography, Progress, Spin, message } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { RewardDistributorABI } from '../abis';
import { formatDistanceToNow } from 'date-fns';

const { Title, Text } = Typography;

interface ClaimRewardProps {
  chainId: number;
  assetId: number;
  rewardId: number;
  contractAddress: string;
}

export const ClaimRewardButton: React.FC<ClaimRewardProps> = ({
  chainId,
  assetId,
  rewardId,
  contractAddress
}) => {
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimData, setClaimData] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [expiryPercentage, setExpiryPercentage] = useState(100);

  useEffect(() => {
    // 有効期限の更新タイマー
    let timer: NodeJS.Timeout;
    
    if (claimData && claimData.expiresAt) {
      const updateTimer = () => {
        const now = new Date().getTime();
        const expiryTime = new Date(claimData.expiresAt).getTime();
        const totalDuration = (expiryTime - claimData.timestamp * 1000);
        const elapsed = now - claimData.timestamp * 1000;
        
        if (now < expiryTime) {
          // 残り時間の計算
          const percent = Math.max(0, Math.min(100, 100 - (elapsed / totalDuration * 100)));
          setExpiryPercentage(percent);
          setTimeRemaining(formatDistanceToNow(expiryTime, { addSuffix: true }));
          timer = setTimeout(updateTimer, 1000);
        } else {
          setExpiryPercentage(0);
          setTimeRemaining('期限切れ');
          setClaimData(null);
        }
      };
      
      updateTimer();
      return () => clearTimeout(timer);
    }
  }, [claimData]);

  // 署名リクエスト
  const requestSignature = async () => {
    try {
      setLoading(true);
      
      // ウォレット接続
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      const userAddress = await signer.getAddress();
      
      // バックエンドからの署名取得
      const response = await fetch('/api/rewards/prepare-claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chainId,
          assetId,
          rewardId,
          userAddress
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to prepare claim');
      }
      
      const data = await response.json();
      setClaimData(data);
      
      message.success('署名取得完了！今すぐ報酬を請求できます');
    } catch (error) {
      console.error('Error preparing claim:', error);
      message.error('署名取得に失敗しました: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 報酬請求実行
  const executeClaimReward = async () => {
    if (!claimData) {
      message.error('先に署名を取得してください');
      return;
    }
    
    try {
      setClaiming(true);
      
      // ウォレット接続
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      
      // コントラクトインスタンス
      const contract = new ethers.Contract(
        contractAddress,
        RewardDistributorABI,
        signer
      );
      
      // 報酬請求トランザクション
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
      
      message.loading('トランザクション処理中...', 0);
      
      // トランザクション確認待ち
      await tx.wait();
      
      message.destroy();
      message.success('報酬請求が完了しました！');
      
      // 状態リセット
      setClaimData(null);
    } catch (error) {
      console.error('Error claiming reward:', error);
      message.error('報酬請求に失敗しました: ' + (error as any).message || '不明なエラー');
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <Title level={4}>報酬請求</Title>
      
      {claimData ? (
        <div>
          <Text>署名の有効期限: {timeRemaining}</Text>
          <Progress percent={expiryPercentage} status={expiryPercentage > 0 ? "active" : "exception"} />
          
          <Button 
            type="primary" 
            onClick={executeClaimReward} 
            loading={claiming} 
            disabled={expiryPercentage <= 0}
            block
            style={{ marginTop: 16 }}
          >
            報酬を請求する
          </Button>
          
          {expiryPercentage <= 0 && (
            <Button 
              onClick={requestSignature} 
              style={{ marginTop: 8 }}
              block
            >
              署名を再取得する
            </Button>
          )}
        </div>
      ) : (
        <Button 
          type="primary" 
          onClick={requestSignature} 
          loading={loading}
          icon={<ClockCircleOutlined />}
          block
        >
          署名を取得して報酬請求を準備
        </Button>
      )}
    </Card>
  );
};