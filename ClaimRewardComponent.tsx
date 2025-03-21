import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { Button, Card, Typography, Progress, Spin, message, Alert, Space, Tooltip, Modal, Steps } from 'antd';
import { 
  ClockCircleOutlined, 
  WarningOutlined, 
  CheckCircleOutlined, 
  QuestionCircleOutlined,
  LockOutlined,
  SafetyOutlined
} from '@ant-design/icons';
import { RewardDistributorABI } from '../abis';
import { formatDistanceToNow, formatDistance } from 'date-fns';
import { ja } from 'date-fns/locale';

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;

interface ClaimRewardProps {
  chainId: number;
  assetId: number;
  rewardId: number;
  airdropId: number;
  contractAddress: string;
}

export const ClaimRewardButton: React.FC<ClaimRewardProps> = ({
  chainId,
  assetId,
  rewardId,
  airdropId,
  contractAddress
}) => {
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimData, setClaimData] = useState<any>(null);
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [expiryPercentage, setExpiryPercentage] = useState(100);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [showExpiredModal, setShowExpiredModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [elapsedTime, setElapsedTime] = useState<string>('');
  const [totalDuration, setTotalDuration] = useState<string>('');

  // 署名の状態を表す色コード
  const getStatusColor = (percentage: number) => {
    if (percentage > 60) return '#52c41a'; // 緑 (安全)
    if (percentage > 30) return '#faad14'; // 黄色 (警告)
    return '#f5222d'; // 赤 (危険)
  };

  // 署名の状態を表すラベル
  const getStatusLabel = (percentage: number) => {
    if (percentage > 60) return '安全';
    if (percentage > 30) return '警告';
    if (percentage > 0) return '間もなく期限切れ';
    return '期限切れ';
  };

  useEffect(() => {
    // 有効期限の更新タイマー
    let timer: NodeJS.Timeout;
    
    if (claimData && claimData.expiresAt) {
      const updateTimer = () => {
        const now = new Date().getTime();
        const expiryTime = new Date(claimData.expiresAt).getTime();
        const timestampMs = claimData.timestamp * 1000;
        const totalDurationMs = (expiryTime - timestampMs);
        const elapsed = now - timestampMs;
        
        // 経過時間と総時間のフォーマット
        setElapsedTime(formatDistance(timestampMs, now, { locale: ja }));
        setTotalDuration(formatDistance(timestampMs, expiryTime, { locale: ja }));
        
        if (now < expiryTime) {
          // 残り時間の計算
          const percent = Math.max(0, Math.min(100, 100 - (elapsed / totalDurationMs * 100)));
          setExpiryPercentage(percent);
          setTimeRemaining(formatDistanceToNow(expiryTime, { addSuffix: true, locale: ja }));
          
          // 残り時間が少なくなったら警告表示
          if (percent <= 20 && percent > 10 && !showExpiredModal) {
            message.warning('署名の有効期限が近づいています。早めに請求してください。');
          }
          
          // 10%以下になったらモーダル表示
          if (percent <= 10 && percent > 0 && !showExpiredModal) {
            setShowExpiredModal(true);
          }
          
          timer = setTimeout(updateTimer, 1000);
        } else {
          setExpiryPercentage(0);
          setTimeRemaining('期限切れ');
          
          // 期限切れのモーダル表示
          if (!showExpiredModal) {
            setShowExpiredModal(true);
          }
        }
      };
      
      updateTimer();
      return () => clearTimeout(timer);
    }
  }, [claimData, showExpiredModal]);

  // 署名リクエスト
  const requestSignature = async () => {
    setErrorMessage(null);
    setClaimSuccess(false);
    setShowExpiredModal(false);
    
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
          airdropId,
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
      setClaimSuccess(true);
    } catch (error) {
      console.error('Error claiming reward:', error);
      // エラーメッセージの改善: Airdrop無効の特定エラーメッセージをわかりやすく表示
      const errorMsg = (error as any).message || '不明なエラー';
      
      if (errorMsg.includes('Airdrop is not valid')) {
        setErrorMessage('このAirdropはすでに終了しているか、無効になっています');
      } else if (errorMsg.includes('Signature expired')) {
        setErrorMessage('署名の有効期限が切れています。新しい署名を取得してください');
        setClaimData(null); // 署名期限切れの場合はデータをクリア
      } else if (errorMsg.includes('Reward already claimed')) {
        setErrorMessage('この報酬はすでに請求済みです');
      } else {
        setErrorMessage('報酬請求に失敗しました: ' + errorMsg);
      }
      
      message.error('報酬請求に失敗しました');
    } finally {
      setClaiming(false);
    }
  };

  // 署名についての説明モーダル
  const renderInfoModal = () => {
    return (
      <Modal
        title="署名の有効期限について"
        open={showInfoModal}
        onCancel={() => setShowInfoModal(false)}
        footer={[
          <Button key="close" onClick={() => setShowInfoModal(false)}>
            閉じる
          </Button>
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Paragraph>
            <SafetyOutlined /> <strong>署名の有効期限が設定されている理由:</strong>
          </Paragraph>
          <Paragraph>
            署名には有効期限が設定されています。これはセキュリティ対策の一環で、古い署名が不正に使われるリスクを減らすためです。
          </Paragraph>

          <Paragraph>
            <LockOutlined /> <strong>署名とは何ですか？</strong>
          </Paragraph>
          <Paragraph>
            署名は、あなたがこの報酬を請求する権利を持っていることを証明するデジタル証明書のようなものです。
            バックエンドサーバーで生成され、暗号技術を使用して保護されています。
          </Paragraph>

          <Steps direction="vertical" current={-1} style={{ marginTop: 20 }}>
            <Step 
              title="署名の取得" 
              description="「署名を取得」ボタンをクリックすると、バックエンドサーバーが署名を生成します。" 
              icon={<ClockCircleOutlined />} 
            />
            <Step 
              title="有効期限の確認" 
              description="署名にはセキュリティ上の理由から有効期限があります（通常1時間）。" 
              icon={<SafetyOutlined />} 
            />
            <Step 
              title="報酬の請求" 
              description="有効期限内に報酬を請求してください。期限が切れた場合は新しい署名を取得できます。" 
              icon={<CheckCircleOutlined />} 
            />
          </Steps>

          {claimData && (
            <Alert
              message="現在の署名情報"
              description={
                <Space direction="vertical">
                  <Text>取得してから: {elapsedTime}</Text>
                  <Text>有効期間: {totalDuration}</Text>
                  <Text>残り時間: {timeRemaining}</Text>
                </Space>
              }
              type="info"
              showIcon
            />
          )}
        </Space>
      </Modal>
    );
  };

  // 期限切れモーダル
  const renderExpiredModal = () => {
    return (
      <Modal
        title={expiryPercentage <= 0 ? "署名の期限が切れました" : "署名の期限が近づいています"}
        open={showExpiredModal}
        onCancel={() => setShowExpiredModal(false)}
        footer={[
          <Button key="info" onClick={() => {
            setShowExpiredModal(false);
            setShowInfoModal(true);
          }}>
            詳細情報
          </Button>,
          <Button 
            key="renew" 
            type="primary" 
            onClick={() => {
              setShowExpiredModal(false);
              requestSignature();
            }}
          >
            {expiryPercentage <= 0 ? "新しい署名を取得" : "署名を更新"}
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {expiryPercentage <= 0 ? (
            <Alert
              message="署名の期限が切れました"
              description="セキュリティ上の理由から、署名には有効期限が設定されています。新しい署名を取得して、報酬請求を続けてください。"
              type="error"
              showIcon
              icon={<WarningOutlined />}
            />
          ) : (
            <Alert
              message="署名の期限が近づいています"
              description={`あと${timeRemaining}で署名が無効になります。すぐに報酬を請求するか、新しい署名を取得することをお勧めします。`}
              type="warning"
              showIcon
              icon={<ClockCircleOutlined />}
            />
          )}
          
          <Paragraph style={{ marginTop: 16 }}>
            署名の有効期限が切れると、トランザクションが失敗する可能性があります。
            これはあなたの報酬を保護するためのセキュリティ機能です。
          </Paragraph>
        </Space>
      </Modal>
    );
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={4}>報酬請求</Title>
          <Tooltip title="署名の有効期限について詳しく知る">
            <Button 
              type="text" 
              icon={<QuestionCircleOutlined />} 
              onClick={() => setShowInfoModal(true)}
            />
          </Tooltip>
        </div>
        
        {claimSuccess && (
          <Alert
            message="請求成功"
            description="報酬請求が正常に完了しました！トークンがウォレットに送信されました。"
            type="success"
            showIcon
            icon={<CheckCircleOutlined />}
            style={{ marginBottom: 16 }}
            closable
            onClose={() => setClaimSuccess(false)}
          />
        )}
        
        {errorMessage && (
          <Alert
            message="エラーが発生しました"
            description={errorMessage}
            type="error"
            showIcon
            icon={<WarningOutlined />}
            style={{ marginBottom: 16 }}
            closable
            onClose={() => setErrorMessage(null)}
          />
        )}
        
        {claimData ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text>署名の有効期限: {timeRemaining}</Text>
              <Text style={{ color: getStatusColor(expiryPercentage) }}>
                {getStatusLabel(expiryPercentage)}
              </Text>
            </div>
            
            <Tooltip title={`署名の有効期間: ${totalDuration}、経過時間: ${elapsedTime}`}>
              <Progress 
                percent={expiryPercentage} 
                status={expiryPercentage > 0 ? "active" : "exception"} 
                strokeColor={getStatusColor(expiryPercentage)}
              />
            </Tooltip>
            
            {expiryPercentage <= 30 && expiryPercentage > 0 && (
              <Alert
                message="署名の期限が近づいています"
                description="早めに報酬を請求してください。期限切れになると新しい署名が必要になります。"
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button 
                type="primary" 
                onClick={executeClaimReward} 
                loading={claiming} 
                disabled={expiryPercentage <= 0}
                block
                icon={<CheckCircleOutlined />}
              >
                報酬を請求する
              </Button>
              
              <Button 
                onClick={requestSignature} 
                style={{ marginTop: 8 }}
                loading={loading}
                block
                icon={<ClockCircleOutlined />}
              >
                署名を再取得する
              </Button>
            </Space>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              message="報酬請求の手順"
              description={
                <ol style={{ paddingLeft: 20, marginBottom: 0 }}>
                  <li>署名を取得する（有効期限: 1時間）</li>
                  <li>「報酬を請求する」ボタンをクリックしてトランザクションを送信</li>
                  <li>トランザクションが承認されると報酬が受け取れます</li>
                </ol>
              }
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            
            <Button 
              type="primary" 
              onClick={requestSignature} 
              loading={loading}
              icon={<ClockCircleOutlined />}
              block
            >
              署名を取得して報酬請求を準備
            </Button>
          </Space>
        )}
      </Space>
      
      {renderInfoModal()}
      {renderExpiredModal()}
    </Card>
  );
};