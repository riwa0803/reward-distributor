import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { 
  Button, Card, Typography, Table, Tag, Space, message, 
  Modal, Alert, Tooltip, Progress, Checkbox, Badge
} from 'antd';
import { 
  ClockCircleOutlined, InfoCircleOutlined, 
  CheckCircleOutlined, WarningOutlined, 
  SafetyOutlined, QuestionCircleOutlined
} from '@ant-design/icons';
import { RewardDistributorABI } from '../abis';
import { formatDistanceToNow } from 'date-fns';
import { ja } from 'date-fns/locale';

const { Title, Text, Paragraph } = Typography;

// 報酬データの型
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

export const BatchClaimComponent: React.FC<BatchClaimProps> = ({
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
  
  // 報酬データの更新タイマー
  useEffect(() => {
    // 定期的に有効期限をチェック
    const timer = setInterval(() => {
      updateExpiryStatus();
    }, 30000);
    
    return () => clearInterval(timer);
  }, [rewardsWithSignatures]);
  
  // 有効期限ステータスの更新
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
        
        // 期限切れチェック
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
    
    // 期限切れの署名がある場合、警告表示
    const hasExpired = updatedRewards.some(r => r.status === 'expired' && r.selected);
    if (hasExpired && !showExpiredModal) {
      message.warning('一部の署名が期限切れになっています。新しい署名を取得してください。');
    }
  };

  // バッチ準備 (署名取得)
  const prepareSignatures = async () => {
    if (selectedRewards.length === 0) {
      message.warning('請求する報酬を選択してください');
      return;
    }
    
    setPreparingSignatures(true);
    try {
      // ウォレット接続
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = provider.getSigner();
      const userAddress = await signer.getAddress();
      
      const preparedRewards = [...rewardsWithSignatures];
      let newSignaturesCount = 0;
      
      // 各報酬について署名を取得
      for (const reward of selectedRewards) {
        // すでに有効な署名がある場合はスキップ
        if (reward.status === 'ready' && reward.signature) continue;
        
        try {
          // バックエンドから署名を取得
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
            throw new Error(`報酬ID ${reward.rewardId} の署名取得に失敗しました`);
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
          message.error(`報酬ID ${reward.rewardId} の署名取得に失敗しました`);
        }
      }
      
      setRewardsWithSignatures(preparedRewards);
      
      if (newSignaturesCount > 0) {
        message.success(`${newSignaturesCount}個の署名を取得しました！`);
      } else {
        message.info('新しく取得した署名はありません');
      }
      
    } catch (error) {
      console.error('Error preparing signatures:', error);
      message.error('署名の準備中にエラーが発生しました');
    } finally {
      setPreparingSignatures(false);
    }
  };

  // バッチ請求実行
  const executeBatchClaim = async () => {
    // 署名済みかつ選択されている報酬のみフィルタリング
    const readyRewards = rewardsWithSignatures.filter(
      r => r.selected && r.status === 'ready' && r.signature
    );
    
    if (readyRewards.length === 0) {
      message.warning('有効な署名を持つ報酬が選択されていません');
      return;
    }
    
    setClaimingRewards(true);
    try {
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
      
      // ノンス取得（すべての報酬で同じノンスを使用）
      const userAddress = await signer.getAddress();
      const nonce = await contract.getNonce(userAddress);
      
      // バッチクレームパラメータの準備
      const claimParams = readyRewards.map(reward => ({
        chainId: reward.chainId,
        assetId: reward.assetId,
        rewardId: reward.rewardId,
        timestamp: reward.timestamp,
        signature: reward.signature,
        amount: ethers.utils.parseUnits(reward.amount, 18), // トークンに合わせて調整必要
        tokenId: reward.tokenId || 0
      }));
      
      message.loading('バッチ請求のトランザクションを処理中...', 0);
      
      // バッチクレーム実行
      const tx = await contract.claimRewardBatch(claimParams, nonce);
      const receipt = await tx.wait();
      
      message.destroy();
      
      // 成功イベントからクレームされた報酬IDを抽出
      const batchEvent = receipt.events?.find(e => e.event === 'BatchRewardClaimed');
      const individualEvents = receipt.events?.filter(e => e.event === 'RewardClaimed') || [];
      
      if (batchEvent) {
        const claimCount = batchEvent.args.claimCount.toNumber();
        message.success(`${claimCount}個の報酬請求が完了しました！`);
        
        // 成功した報酬を更新
        const claimedIds = individualEvents.map(e => {
          const assetId = e.args.assetId.toNumber();
          const rewardId = e.args.rewardId.toNumber();
          return `${assetId}-${rewardId}`;
        });
        
        // 親コンポーネントに成功通知
        onClaimSuccess(claimedIds);
        
        // 状態更新
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
      // エラーハンドリング改善
      const errorMsg = (error as any).message || '不明なエラー';
      
      if (errorMsg.includes('user rejected')) {
        message.error('トランザクションがキャンセルされました');
      } else if (errorMsg.includes('insufficient funds')) {
        message.error('ガス代が不足しています。ウォレットに十分なETHがあるか確認してください');
      } else if (errorMsg.includes('No rewards claimed successfully')) {
        message.error('報酬の請求に失敗しました。署名の有効期限が切れているか、すでに請求済みです');
      } else {
        message.error('バッチ請求処理中にエラーが発生しました: ' + errorMsg);
      }
    } finally {
      setClaimingRewards(false);
      message.destroy(); // ローディングメッセージをクリア
    }
  };

  // 報酬の選択状態変更
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

  // すべての報酬選択/解除
  const toggleSelectAll = (e: any) => {
    const isSelected = e.target.checked;
    const updatedRewards = rewards.map(reward => ({
      ...reward,
      selected: isSelected
    }));
    
    setSelectedRewards(isSelected ? [...updatedRewards] : []);
  };

  // ステータスに基づくタグ表示
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

  // 署名有効期限の進捗バー
  const renderExpiryProgress = (reward: RewardData) => {
    if (!reward.expiryPercentage || reward.status !== 'ready') return null;
    
    let color = '#52c41a'; // 緑
    if (reward.expiryPercentage < 60) color = '#faad14'; // 黄色
    if (reward.expiryPercentage < 30) color = '#f5222d'; // 赤
    
    return (
      <Tooltip title={reward.expiresAt ? `有効期限: ${formatDistanceToNow(reward.expiresAt, { addSuffix: true, locale: ja })}` : ''}>
        <Progress percent={Math.round(reward.expiryPercentage)} size="small" strokeColor={color} />
      </Tooltip>
    );
  };

  // カラム定義
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

  // 署名についての説明モーダル
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

  // 期限切れモーダル
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

  // バッチ請求可能な報酬数
  const readyRewardsCount = rewardsWithSignatures.filter(
    r => r.selected && r.status === 'ready'
  ).length;

  // 選択した報酬の中で期限切れのものがあるか
  const hasExpiredSelected = rewardsWithSignatures.some(
    r => r.selected && r.status === 'expired'
  );

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