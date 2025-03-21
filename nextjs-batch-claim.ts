'use client';

import React, { useState, useEffect } from 'react';
import { 
  Button, Card, Typography, Table, Tag, Space, Modal, 
  Alert, Tooltip, Progress, Checkbox, Badge, Spin
} from 'antd';
import { 
  ClockCircleOutlined, InfoCircleOutlined, 
  CheckCircleOutlined, WarningOutlined, 
  SafetyOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale';
import dynamic from 'next/dynamic';

const { Title, Text, Paragraph } = Typography;

// Dynamic imports to avoid SSR issues
const ethersImport = dynamic(() => import('ethers'), { ssr: false });

// Reward data type
interface RewardData {
  key: string;
  chainId: number;
  assetId: number;
  rewardId: number;
  airdropId: number;
  amount: string;
  tokenId?: number;
  tokenType: string;
  tokenName: string;
  signature?: string;
  nonce?: number;
  timestamp?: number;
  expiresAt?: Date;
  selected: boolean;
  status: 'pending' | 'ready' | 'expired' | 'claimed';
  expiryPercentage?: number;
}

interface BatchClaimProps {
  rewards: RewardData[];
  contractAddress: string;
  onClaimSuccess: (claimedRewardIds: string[]) => void;
}

const BatchClaimComponent: React.FC<BatchClaimProps> = ({
  rewards,
  contractAddress,
  onClaimSuccess
}) => {
  const [selectedRewards, setSelectedRewards] = useState<RewardData[]>([]);
  const [preparingSignatures, setPreparingSignatures] = useState(false);
  const [claimingRewards, setClaimingRewards] = useState(false);
  const [rewardsWithSignatures, setRewardsWithSignatures] = useState<RewardData[]>([]);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showExpiredModal, setShowExpiredModal] = useState(false);
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
  
  // Check expiry status periodically
  useEffect(() => {
    const timer = setInterval(() => {
      updateExpiryStatus();
    }, 30000);
    
    return () => clearInterval(timer);
  }, [rewardsWithSignatures]);
  
  // Update reward expiry status
  const updateExpiryStatus = () => {
    if (rewardsWithSignatures.length === 0) return;
    
    const now = new Date();
    const updatedRewards = rewardsWithSignatures.map(reward => {
      if (reward.expiresAt && reward.timestamp) {
        const expiryTime = new Date(reward.expiresAt).getTime();
        const timestampMs = reward.timestamp * 1000;
        const totalDuration = (expiryTime - timestampMs);
        const elapsed = now.getTime() - timestampMs;
        const percentage = Math.max(0, Math.min(100, 100 - (elapsed / totalDuration * 100)));
        
        // Check if expired
        const newStatus = now > reward.expiresAt ? 'expired' : 'ready';
        
        return {
          ...reward,
          expiryPercentage: percentage,
          status: newStatus
        };
      }
      return reward;
    });
    
    setRewardsWithSignatures(updatedRewards);
    
    // Show warning if any selected rewards have expired signatures
    const hasExpired = updatedRewards.some(r => r.status === 'expired' && r.selected);
    if (hasExpired && !showExpiredModal) {
      console.warn('Some signatures have expired');
    }
  };

  // Prepare signatures
  const prepareSignatures = async () => {
    if (!ethers || !ABI) return;
    
    if (selectedRewards.length === 0) {
      console.warn('No rewards selected');
      return;
    }
    
    setPreparingSignatures(true);
    try {
      // Check if browser environment
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask or compatible wallet not detected');
      }
      
      // Connect wallet
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      const userAddress = await signer.getAddress();
      
      const preparedRewards = [...rewardsWithSignatures];
      let newSignaturesCount = 0;
      
      // Get signatures for each reward
      for (const reward of selectedRewards) {
        // Skip rewards that already have valid signatures
        if (reward.status === 'ready' && reward.signature) continue;
        
        try {
          // Get signature from backend
          const response = await fetch('/api/rewards/prepare-claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chainId: reward.chainId,
              assetId: reward.assetId,
              rewardId: reward.rewardId,
              airdropId: reward.airdropId,
              userAddress
            })
          });
          
          if (!response.ok) {
            throw new Error(`Failed to get signature for reward ID ${reward.rewardId}`);
          }
          
          const data = await response.json();
          const index = preparedRewards.findIndex(r => 
            r.chainId === reward.chainId && 
            r.assetId === reward.assetId && 
            r.rewardId === reward.rewardId
          );
          
          const now = new Date();
          const expiryTime = new Date(data.expiresAt).getTime();
          const timestampMs = data.timestamp * 1000;
          const totalDuration = (expiryTime - timestampMs);
          const elapsed = now.getTime() - timestampMs;
          const percentage = Math.max(0, Math.min(100, 100 - (elapsed / totalDuration * 100)));
          
          if (index >= 0) {
            preparedRewards[index] = {
              ...preparedRewards[index],
              signature: data.signature,
              nonce: data.nonce,
              timestamp: data.timestamp,
              expiresAt: new Date(data.expiresAt),
              status: 'ready',
              expiryPercentage: percentage
            };
          } else {
            preparedRewards.push({
              ...reward,
              signature: data.signature,
              nonce: data.nonce,
              timestamp: data.timestamp,
              expiresAt: new Date(data.expiresAt),
              status: 'ready',
              expiryPercentage: percentage
            });
          }
          
          newSignaturesCount++;
        } catch (error) {
          console.error(`Error preparing signature for reward ${reward.rewardId}:`, error);
        }
      }
      
      setRewardsWithSignatures(preparedRewards);
      
      if (newSignaturesCount > 0) {
        console.log(`${newSignaturesCount} signatures obtained`);
      } else {
        console.info('No new signatures obtained');
      }
      
    } catch (error) {
      console.error('Error preparing signatures:', error);
    } finally {
      setPreparingSignatures(false);
    }
  };

  // Execute batch claim
  const executeBatchClaim = async () => {
    if (!ethers || !ABI) return;
    
    // Filter ready rewards with signatures
    const readyRewards = rewardsWithSignatures.filter(
      r => r.selected && r.status === 'ready' && r.signature
    );
    
    if (readyRewards.length === 0) {
      console.warn('No ready rewards selected');
      return;
    }
    
    setClaimingRewards(true);
    try {
      // Check if browser environment
      if (typeof window === 'undefined' || !window.ethereum) {
        throw new Error('MetaMask or compatible wallet not detected');
      }
      
      // Connect wallet
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      
      // Contract instance
      const contract = new ethers.Contract(
        contractAddress,
        ABI,
        signer
      );
      
      // Get nonce (same for all rewards in batch)
      const userAddress = await signer.getAddress();
      const nonce = await contract.getNonce(userAddress);
      
      // Prepare claim parameters
      const claimParams = readyRewards.map(reward => ({
        chainId: reward.chainId,
        assetId: reward.assetId,
        rewardId: reward.rewardId,
        timestamp: reward.timestamp,
        signature: reward.signature,
        amount: ethers.utils.parseUnits(reward.amount, 18), // Adjust for token decimals
        tokenId: reward.tokenId || 0
      }));
      
      console.log('Processing batch claim transaction...');
      
      // Execute batch claim
      const tx = await contract.claimRewardBatch(claimParams, nonce);
      const receipt = await tx.wait();
      
      console.log('Batch claim transaction completed');
      
      // Extract claimed reward IDs from events
      const batchEvent = receipt.events?.find(e => e.event === 'BatchRewardClaimed');
      const individualEvents = receipt.events?.filter(e => e.event === 'RewardClaimed') || [];
      
      if (batchEvent) {
        const claimCount = batchEvent.args.claimCount.toNumber();
        console.log(`${claimCount} rewards claimed successfully`);
        
        // Get claimed reward IDs
        const claimedIds = individualEvents.map(e => {
          const assetId = e.args.assetId.toNumber();
          const rewardId = e.args.rewardId.toNumber();
          return `${assetId}-${rewardId}`;
        });
        
        // Notify parent component
        onClaimSuccess(claimedIds);
        
        // Update rewards status
        const updatedRewards = rewardsWithSignatures.map(reward => {
          const id = `${reward.assetId}-${reward.rewardId}`;
          if (claimedIds.includes(id)) {
            return { ...reward, status: 'claimed', selected: false };
          }
          return reward;
        });
        
        setRewardsWithSignatures(updatedRewards);
      }
    } catch (error) {
      console.error('Error claiming rewards batch:', error);
    } finally {
      setClaimingRewards(false);
    }
  };

  // Toggle reward selection
  const toggleRewardSelection = (key: string) => {
    const updatedRewards = rewards.map(reward => {
      if (reward.key === key) {
        return { ...reward, selected: !reward.selected };
      }
      return reward;
    });
    
    const selected = updatedRewards.filter(r => r.selected);
    setSelectedRewards(selected);
  };

  // Toggle select all rewards
  const toggleSelectAll = (e: any) => {
    const isSelected = e.target.checked;
    const updatedRewards = rewards.map(reward => ({
      ...reward,
      selected: isSelected
    }));
    
    setSelectedRewards(isSelected ? [...updatedRewards] : []);
  };

  // Render status tag based on reward status
  const getStatusTag = (reward: RewardData) => {
    switch (reward.status) {
      case 'pending':
        return <Tag color="blue">署名待ち</Tag>;
      case 'ready':
        if (reward.expiryPercentage && reward.expiryPercentage < 20) {
          return <Tag color="orange">まもなく期限切れ</Tag>;
        }
        return <Tag color="green">請求可能</Tag>;
      case 'expired':
        return <Tag color="red">期限切れ</Tag>;
      case 'claimed':
        return <Tag color="purple">請求済み</Tag>;
      default:
        return <Tag>未処理</Tag>;
    }
  };

  // Render expiry progress bar
  const renderExpiryProgress = (reward: RewardData) => {
    if (!reward.expiryPercentage || reward.status !== 'ready') return null;
    
    let color = '#52c41a'; // Green
    if (reward.expiryPercentage < 60) color = '#faad14'; // Yellow
    if (reward.expiryPercentage < 30) color = '#f5222d'; // Red
    
    return (
      <Tooltip title={reward.expiresAt ? `有効期限: ${formatDistanceToNow(reward.expiresAt, { addSuffix: true, locale: ja })}` : ''}>
        <Progress percent={Math.round(reward.expiryPercentage)} size="small" strokeColor={color} />
      </Tooltip>
    );
  };

  // Table columns
  const columns = [
    {
      title: <Checkbox onChange={toggleSelectAll} />,
      dataIndex: 'selected',
      key: 'selected',
      render: (_: any, record: RewardData) => (
        <Checkbox 
          checked={record.selected} 
          onChange={() => toggleRewardSelection(record.key)} 
          disabled={record.status === 'claimed'}
        />
      ),
      width: 50
    },
    {
      title: 'トークン',
      dataIndex: 'tokenName',
      key: 'tokenName',
    },
    {
      title: '数量',
      dataIndex: 'amount',
      key: 'amount',
    },
    {
      title: 'タイプ',
      dataIndex: 'tokenType',
      key: 'tokenType',
      render: (text: string) => <Tag>{text}</Tag>
    },
    {
      title: 'ステータス',
      dataIndex: 'status',
      key: 'status',
      render: (_: any, record: RewardData) => getStatusTag(record)
    },
    {
      title: '有効期限',
      dataIndex: 'expiryPercentage',
      key: 'expiryPercentage',
      render: (_: any, record: RewardData) => renderExpiryProgress(record)
    }
  ];

  // Info modal
  const renderInfoModal = () => {
    return (
      <Modal
        title="バッチ報酬請求について"
        open={showInfoModal}
        onCancel={() => setShowInfoModal(false)}
        footer={[
          <Button key="close" onClick={() => setShowInfoModal(false)}>
            閉じる
          </Button>
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            message="ガス代の節約"
            description="バッチ請求を使用すると、複数の報酬を一度のトランザクションで請求できるため、ガス代を大幅に節約できます。"
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            style={{ marginBottom: 16 }}
          />
          
          <Paragraph>
            <SafetyOutlined /> <strong>署名と有効期限:</strong>
          </Paragraph>
          <Paragraph>
            各報酬には個別の署名が必要です。署名にはセキュリティ上の理由から有効期限があります（通常1時間）。
            期限切れの署名は使用できないため、必要に応じて新しい署名を取得してください。
          </Paragraph>
          
          <Paragraph>
            <CheckCircleOutlined /> <strong>バッチ請求の手順:</strong>
          </Paragraph>
          <ol>
            <li>請求したい報酬を選択します</li>
            <li>「署名を取得」ボタンをクリックして全ての選択した報酬の署名を準備します</li>
            <li>「バッチ請求実行」ボタンをクリックして一括請求トランザクションを送信します</li>
            <li>トランザクションが承認されると、全ての報酬が一括で受け取れます</li>
          </ol>
          
          <Alert
            message="注意事項"
            description="バッチ請求は同じAirdropの報酬に対して最も効果的です。署名の有効期限内に請求することをお勧めします。"
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
          />
        </Space>
      </Modal>
    );
  };

  // Expired modal
  const renderExpiredModal = () => {
    const expiredRewards = rewardsWithSignatures.filter(
      r => r.selected && r.status === 'expired'
    );
    
    if (expiredRewards.length === 0) return null;
    
    return (
      <Modal
        title="期限切れの署名があります"
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
              prepareSignatures();
            }}
          >
            署名を更新
          </Button>,
        ]}
      >
        <Alert
          message="一部の署名が期限切れです"
          description="選択した報酬の中に署名が期限切れになったものがあります。「署名を更新」ボタンをクリックして新しい署名を取得してください。"
          type="error"
          showIcon
          icon={<WarningOutlined />}
        />
        
        <Paragraph style={{ marginTop: 16 }}>
          期限切れの報酬:
        </Paragraph>
        
        <ul>
          {expiredRewards.map(reward => (
            <li key={reward.key}>
              {reward.tokenName} - {reward.amount} {reward.tokenType}
            </li>
          ))}
        </ul>
      </Modal>
    );
  };

  // Count ready rewards
  const readyRewardsCount = rewardsWithSignatures.filter(
    r => r.selected && r.status === 'ready'
  ).length;

  // Check if any selected rewards have expired
  const hasExpiredSelected = rewardsWithSignatures.some(
    r => r.selected && r.status === 'expired'
  );

  // Show loading state while dependencies are loading
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
          <Title level={4}>報酬一括請求</Title>
          <Tooltip title="バッチ請求について詳しく知る">
            <Button 
              type="text" 
              icon={<QuestionCircleOutlined />} 
              onClick={() => setShowInfoModal(true)}
            />
          </Tooltip>
        </div>
        
        <Alert
          message="ガス代を節約できます"
          description="複数の報酬を一括で請求することで、ガス代を大幅に節約できます。請求したい報酬を選択し、署名を取得してから一括請求を実行してください。"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        
        <Table 
          dataSource={rewards} 
          columns={columns} 
          rowKey="key"
          pagination={false}
          size="small"
          scroll={{ y: 300 }}
          style={{ marginBottom: 16 }}
        />
        
        <Space direction="horizontal" style={{ marginTop: 16 }}>
          <Button
            type="primary"
            onClick={prepareSignatures}
            loading={preparingSignatures}
            icon={<ClockCircleOutlined />}
            disabled={selectedRewards.length === 0}
          >
            署名を取得 ({selectedRewards.length})
          </Button>
          
          <Button
            type="primary"
            onClick={executeBatchClaim}
            loading={claimingRewards}
            icon={<CheckCircleOutlined />}
            disabled={readyRewardsCount === 0}
            danger={hasExpiredSelected}
          >
            バッチ請求実行 ({readyRewardsCount})
          </Button>
          
          {hasExpiredSelected && (
            <Badge count="!" offset={[-5, 0]}>
              <Button 
                danger 
                onClick={() => setShowExpiredModal(true)}
                icon={<WarningOutlined />}
              >
                期限切れ署名あり
              </Button>
            </Badge>
          )}
        </Space>
      </Space>
      
      {renderInfoModal()}
      {renderExpiredModal()}
    </Card>
  );
};

export default BatchClaimComponent;