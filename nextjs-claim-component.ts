'use client';

import React, { useState, useEffect } from 'react';
import { Button, Card, Typography, Progress, Spin, Alert, Space, Tooltip, Modal, Steps } from 'antd';
import { 
  ClockCircleOutlined, 
  WarningOutlined, 
  CheckCircleOutlined, 
  QuestionCircleOutlined,
  LockOutlined,
  SafetyOutlined
} from '@ant-design/icons';
import { formatDistanceToNow, formatDistance } from 'date-fns';
import { ja } from 'date-fns/locale';
import dynamic from 'next/dynamic';

// Dynamic imports to avoid SSR issues
const ethersImport = dynamic(() => import('ethers'), { ssr: false });

const { Title, Text, Paragraph } = Typography;
const { Step } = Steps;

interface ClaimRewardProps {
  chainId: number;
  assetId: number;
  rewardId: number;
  airdropId: number;
  contractAddress: string;
}

// Error messages mapping
const ERROR_MESSAGES = {
  'Airdrop is not valid': 'このAirdropはすでに終了しているか、無効になっています',
  'Reward already claimed': 'この報酬はすでに請求済みです',
  'Invalid signature': '署名が無効です。再度署名を取得してください',
  'Signature expired': '署名の有効期限が切れています。新しい署名を取得してください',
  'ERC20 transfer failed': 'トークン転送に失敗しました。提供者のアドレスに十分なトークンがあるか確認してください',
  'Invalid nonce': 'トランザクションの順序が無効です。ページを更新して再試行してください',
  'Invalid reward parameters': '報酬パラメータが無効です。システム管理者に連絡してください',
  'User rejected request': 'トランザクションがキャンセルされました',
  'Insufficient funds': 'ガス代が不足しています。ウォレットに十分なETHがあるか確認してください',
  'Network error': 'ネットワーク接続に問題があります。接続を確認して再試行してください',
};

const ClaimRewardButton: React.FC<ClaimRewardProps> = ({
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
  const [ethers, setEthers] = useState<any>(null);
  const [ABI, setABI] = useState<any>(null);

  // Load ethers.js and ABI dynamically
  useEffect(() => {
    const loadDependencies = async () => {
      const ethersModule = await import('ethers');
      setEthers(ethersModule);
      
      const { RewardDistributorABI } = await import('../abis');
      setABI(RewardDistributorABI);
    };
    
    loadDependencies();
  }, []);

  // Function to get status color based on percentage
  const getStatusColor = (percentage: number) => {
    if (percentage > 60) return '#52c41a'; // Green (safe)
    if (percentage > 30) return '#faad14'; // Yellow (warning)
    return '#f5222d'; // Red (danger)
  };

  // Function to get status label based on percentage
  const getStatusLabel = (percentage: number) => {
    if (percentage > 60) return '安全';
    if (percentage > 30) return '警告';
    if (percentage > 0) return '間もなく期限切れ';
    return '期限切れ';
  };

  // Timer for signature expiration
  useEffect(() => {
    let timer: NodeJS.Timeout;
    
    if (claimData && claimData.expiresAt) {
      const updateTimer = () => {
        const now = new Date().getTime();
        const expiryTime = new Date(claimData.expiresAt).getTime();
        const timestampMs = claimData.timestamp * 1000;
        const totalDurationMs = (expiryTime - timestampMs);
        const elapsed = now - timestampMs;
        
        // Format elapsed time and total duration
        setElapsedTime(formatDistance(timestampMs, now, { locale: ja }));
        setTotalDuration(formatDistance(timestampMs, expiryTime, { locale: ja }));
        
        if (now < expiryTime) {
          // Calculate remaining time
          const percent = Math.max(0, Math.min(100, 100 - (elapsed / totalDurationMs * 100)));
          setExpiryPercentage(percent);
          setTimeRemaining(formatDistanceToNow(expiryTime, { addSuffix: true, locale: ja }));
          
          // Show warning when expiration is near
          if (percent <= 20 && percent > 10 && !showExpiredModal) {
            console.warn('Signature expiration approaching');
          }
          
          // Show modal when expiration is very near
          if (percent <= 10 && percent > 0 && !showExpiredModal) {
            setShowExpiredModal(true);
          }
          
          timer = setTimeout(updateTimer, 1000);
        } else {
          setExpiryPercentage(0);
          setTimeRemaining('期限切れ');
          
          // Show expired modal
          if (!showExpiredModal) {
            setShowExpiredModal(true);
          }
        }
      };
      
      updateTimer();
      return () => clearTimeout(timer);
    }
  }, [claimData, showExpiredModal]);

  // Request signature
  const requestSignature = async () => {
    if (!ethers) return;
    
    setErrorMessage(null);
    setClaimSuccess(false);
    setShowExpiredModal(false);
    
    try {
      setLoading(true);
      
      // Check if window is defined (browser environment)
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask or compatible wallet not detected');
      }
      
      // Connect to wallet
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      const userAddress = await signer.getAddress();
      
      // Get signature from backend
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
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to prepare claim');
      }
      
      const data = await response.json();
      setClaimData(data);
      
      console.log('Signature obtained successfully');
    } catch (error) {
      console.error('Error preparing claim:', error);
      const errorMsg = (error as Error).message;
      
      // Customize error message
      if (errorMsg.includes('Airdrop is not valid') || errorMsg.includes('expired')) {
        setErrorMessage('このAirdropはすでに終了しているか、無効になっています');
      } else if (errorMsg.includes('Reward already claimed')) {
        setErrorMessage('この報酬はすでに請求済みです');
      } else if (errorMsg.includes('Reward not found')) {
        setErrorMessage('報酬が見つかりません。もしくはあなたは受取対象ではありません');
      } else if (errorMsg.includes('User denied') || errorMsg.includes('user rejected')) {
        setErrorMessage('ウォレット接続がキャンセルされました');
      } else if (errorMsg.includes('network') || errorMsg.includes('connection')) {
        setErrorMessage('ネットワーク接続に問題があります。接続を確認して再試行してください');
      } else if (errorMsg.includes('MetaMask or compatible wallet not detected')) {
        setErrorMessage('ウォレットが見つかりません。MetaMaskまたは互換性のあるウォレットをインストールしてください');
      } else {
        setErrorMessage(`署名取得に失敗しました: ${errorMsg}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Execute claim
  const executeClaimReward = async () => {
    if (!ethers || !ABI) return;
    
    if (!claimData) {
      setErrorMessage('先に署名を取得してください');
      return;
    }
    
    try {
      setClaiming(true);
      
      // Check if window is defined (browser environment)
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask or compatible wallet not detected');
      }
      
      // Connect to wallet
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      
      // Contract instance
      const contract = new ethers.Contract(
        contractAddress,
        ABI,
        signer
      );
      
      // Claim transaction
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
      
      console.log('Transaction processing...');
      
      // Wait for transaction confirmation
      await tx.wait();
      
      console.log('Reward claim successful');
      
      // Reset state
      setClaimData(null);
      setClaimSuccess(true);
    } catch (error) {
      console.error('Error claiming reward:', error);
      // Improve error messages
      const errorMsg = (error as any).message || '不明なエラー';
      
      if (errorMsg.includes('Airdrop is not valid')) {
        setErrorMessage('このAirdropはすでに終了しているか、無効になっています');
      } else if (errorMsg.includes('Signature expired')) {
        setErrorMessage('署名の有効期限が切れています。新しい署名を取得してください');
        setClaimData(null); // Clear data for expired signature
      } else if (errorMsg.includes('Reward already claimed')) {
        setErrorMessage('この報酬はすでに請求済みです');
      } else if (errorMsg.includes('MetaMask or compatible wallet not detected')) {
        setErrorMessage('ウォレットが見つかりません。MetaMaskまたは互換性のあるウォレットをインストールしてください');
      } else {
        // Check for common errors
        for (const [errorKey, errorValue] of Object.entries(ERROR_MESSAGES)) {
          if (errorMsg.includes(errorKey)) {
            setErrorMessage(errorValue);
            break;
          }
        }
        
        if (!errorMessage) {
          setErrorMessage('報酬請求に失敗しました: ' + errorMsg);
        }
      }
    } finally {
      setClaiming(false);
    }
  };

  // Signature info modal
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

  // Expiry modal
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

  // Check if dependencies are loaded
  if (!ethers || !ABI) {
    return (
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
          <Spin tip="ライブラリをロード中..." />
        </div>
      </Card>
    );
  }

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

export default ClaimRewardButton;