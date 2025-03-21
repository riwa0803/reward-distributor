// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/ECDSAUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

// AirdropRegistryインターフェース
interface IAirdropRegistry {
    function isAirdropValid(uint256 airdropId) external view returns (bool isValid, uint256 endDate);
}

/**
 * @title RewardDistributor
 * @dev コントラクトはユーザーへのトークン報酬配布を管理します
 * プロキシパターンを採用しており、アップグレード可能です
 * AirdropIDとオンチェーンコミットメントによるセキュリティ強化版
 * 署名有効期限機能追加
 * AirdropRegistryとの連携機能追加
 * バッチ請求機能追加によるガス最適化
 */
contract RewardDistributor is 
    Initializable, 
    UUPSUpgradeable, 
    OwnableUpgradeable, 
    ReentrancyGuardUpgradeable,
    PausableUpgradeable {
    
    using ECDSAUpgradeable for bytes32;
    
    // トークンの種類を表す列挙型
    enum AssetType { ERC20, ERC721, ERC1155 }
    
    // アセット情報の構造体
    struct Asset {
        address tokenAddress;  // トークンのコントラクトアドレス
        AssetType assetType;   // トークンの種類
        address provider;      // 報酬提供者のアドレス
        bool isActive;         // アクティブ状態
    }
    
    // 報酬情報の構造体
    struct Reward {
        address userAddress;   // 受取ユーザーのアドレス
        uint256 amount;        // 数量（ERC20の場合はトークン数、ERC721/ERC1155の場合は常に1）
        uint256 tokenId;       // トークンID（ERC721/ERC1155の場合に使用）
        bool claimed;          // 受取済みフラグ
    }

    // バッチクレーム用のパラメータ構造体
    struct ClaimParams {
        uint256 chainId;       // チェーンID
        uint256 assetId;       // アセットID
        uint256 rewardId;      // 報酬ID
        uint256 timestamp;     // 署名タイムスタンプ
        bytes signature;       // 署名
        uint256 amount;        // 数量
        uint256 tokenId;       // トークンID
    }

    // バックエンド署名検証用のアドレス
    address public verifier;
    
    // 署名の有効期間（秒）
    uint256 public signatureExpiryDuration;
    
    // AirdropRegistryコントラクトのアドレス
    address public airdropRegistry;
    
    // アセットIDからアセット情報へのマッピング
    mapping(uint256 => Asset) public assets;
    
    // アセットIDと報酬IDから報酬情報へのマッピング
    mapping(uint256 => mapping(uint256 => Reward)) public rewards;

    // アセットIDと報酬IDから報酬コミットメントへのマッピング
    mapping(uint256 => mapping(uint256 => bytes32)) public rewardCommitments;

    // 報酬IDからAirdropIDへのマッピング
    mapping(uint256 => uint256) public rewardAirdropIds;
    
    // 報酬IDの取得済み状態を管理するビットマップ
    mapping(uint256 => mapping(uint256 => uint256)) public claimedBitmap;
    
    // アドレスからノンス値へのマッピング
    mapping(address => uint256) public nonces;
    
    // オペレータ権限のマッピング
    mapping(address => bool) public operators;
    
    // 次のアセットID
    uint256 public nextAssetId;

    // イベント定義
    event AssetRegistered(uint256 indexed assetId, address indexed tokenAddress, AssetType assetType, address provider);
    event RewardRegistered(uint256 indexed assetId, uint256 indexed airdropId, uint256 rewardId, address recipient, uint256 amount, uint256 tokenId);
    event RewardClaimed(
        uint256 indexed chainId,
        address indexed userAddress,
        uint256 indexed assetId,
        uint256 rewardId
    );
    event BatchRewardClaimed(
        address indexed userAddress,
        uint256 claimCount
    );
    event VerifierUpdated(address previousVerifier, address newVerifier);
    event AirdropRegistryUpdated(address previousRegistry, address newRegistry);
    event AssetProviderUpdated(uint256 indexed assetId, address previousProvider, address newProvider);
    event AssetStatusUpdated(uint256 indexed assetId, bool isActive);
    event RewardCommitmentSet(uint256 indexed assetId, uint256 indexed rewardId, bytes32 commitment);
    event SignatureExpiryDurationUpdated(uint256 previousDuration, uint256 newDuration);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);

    /**
     * @dev 初期化関数
     * @param _verifier バックエンド署名検証用のアドレス
     * @param _signatureExpiryDuration 署名の有効期間（秒）
     */
    function initialize(address _verifier, uint256 _signatureExpiryDuration) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        
        verifier = _verifier;
        signatureExpiryDuration = _signatureExpiryDuration;
        nextAssetId = 0;
    }
    
    /**
     * @dev アップグレード権限チェック
     * @param newImplementation 新しい実装コントラクトのアドレス
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
    
    /**
     * @dev 検証者アドレスの更新
     * @param _verifier 新しい検証者アドレス
     */
    function updateVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "Invalid verifier address");
        address previousVerifier = verifier;
        verifier = _verifier;
        emit VerifierUpdated(previousVerifier, _verifier);
    }

    /**
     * @dev AirdropRegistryアドレスの設定
     * @param _registry AirdropRegistryコントラクトのアドレス
     */
    function setAirdropRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "Invalid registry address");
        address previousRegistry = airdropRegistry;
        airdropRegistry = _registry;
        emit AirdropRegistryUpdated(previousRegistry, _registry);
    }
    
    /**
     * @dev オペレータの追加
     * @param _operator オペレータのアドレス
     */
    function addOperator(address _operator) external onlyOwner {
        require(_operator != address(0), "Invalid operator address");
        require(!operators[_operator], "Already an operator");
        
        operators[_operator] = true;
        emit OperatorAdded(_operator);
    }
    
    /**
     * @dev オペレータの削除
     * @param _operator オペレータのアドレス
     */
    function removeOperator(address _operator) external onlyOwner {
        require(operators[_operator], "Not an operator");
        
        operators[_operator] = false;
        emit OperatorRemoved(_operator);
    }

    /**
     * @dev 署名有効期間の更新
     * @param _signatureExpiryDuration 新しい署名有効期間（秒）
     */
    function updateSignatureExpiryDuration(uint256 _signatureExpiryDuration) external onlyOwner {
        require(_signatureExpiryDuration > 0, "Invalid signature expiry duration");
        uint256 previousDuration = signatureExpiryDuration;
        signatureExpiryDuration = _signatureExpiryDuration;
        emit SignatureExpiryDurationUpdated(previousDuration, _signatureExpiryDuration);
    }
    
    /**
     * @dev アセットの登録
     * @param _tokenAddress トークンコントラクトのアドレス
     * @param _assetType アセットの種類（0: ERC20, 1: ERC721, 2: ERC1155）
     * @param _provider 報酬提供者のアドレス
     * @return assetId 登録されたアセットのID
     */
    function registerAsset(
        address _tokenAddress,
        AssetType _assetType,
        address _provider
    ) external whenNotPaused returns (uint256) {
        require(_tokenAddress != address(0), "Invalid token address");
        require(_provider != address(0), "Invalid provider address");
        require(msg.sender == owner() || operators[msg.sender], "Unauthorized");
        
        uint256 assetId = nextAssetId;
        assets[assetId] = Asset({
            tokenAddress: _tokenAddress,
            assetType: _assetType,
            provider: _provider,
            isActive: true
        });
        
        nextAssetId++;
        
        emit AssetRegistered(assetId, _tokenAddress, _assetType, _provider);
        
        return assetId;
    }
    
    /**
     * @dev アセット提供者の更新
     * @param _assetId アセットID
     * @param _newProvider 新しい提供者アドレス
     */
    function updateAssetProvider(uint256 _assetId, address _newProvider) external whenNotPaused {
        require(assets[_assetId].tokenAddress != address(0), "Asset does not exist");
        require(_newProvider != address(0), "Invalid provider address");
        require(
            msg.sender == owner() || 
            operators[msg.sender] || 
            msg.sender == assets[_assetId].provider, 
            "Unauthorized"
        );
        
        address previousProvider = assets[_assetId].provider;
        assets[_assetId].provider = _newProvider;
        
        emit AssetProviderUpdated(_assetId, previousProvider, _newProvider);
    }
    
    /**
     * @dev アセットの有効/無効状態を更新
     * @param _assetId アセットID
     * @param _isActive アクティブ状態
     */
    function updateAssetStatus(uint256 _assetId, bool _isActive) external whenNotPaused {
        require(assets[_assetId].tokenAddress != address(0), "Asset does not exist");
        require(
            msg.sender == owner() || 
            operators[msg.sender] || 
            msg.sender == assets[_assetId].provider, 
            "Unauthorized"
        );
        
        assets[_assetId].isActive = _isActive;
        
        emit AssetStatusUpdated(_assetId, _isActive);
    }

    /**
     * @dev 報酬を登録し、AirdropIDを関連付ける
     * @param _assetId アセットID
     * @param _airdropId AirdropID（バックエンドとの紐付け用）
     * @param _recipient 受取人アドレス
     * @param _amount 数量
     * @param _tokenId トークンID
     * @return rewardId 登録された報酬ID
     */
    function registerRewardWithAirdrop(
        uint256 _assetId,
        uint256 _airdropId,
        address _recipient,
        uint256 _amount,
        uint256 _tokenId
    ) external whenNotPaused returns (uint256) {
        require(assets[_assetId].tokenAddress != address(0), "Asset does not exist");
        require(assets[_assetId].isActive, "Asset is not active");
        require(_recipient != address(0), "Invalid recipient address");
        require(
            msg.sender == owner() || 
            operators[msg.sender] || 
            msg.sender == assets[_assetId].provider, 
            "Unauthorized"
        );
        
        // Airdropの有効性をチェック（AirdropRegistryが設定されている場合）
        if (airdropRegistry != address(0)) {
            (bool isValid, ) = IAirdropRegistry(airdropRegistry).isAirdropValid(_airdropId);
            require(isValid, "Airdrop is not valid");
        }
        
        // 次の利用可能な報酬IDを計算（簡易実装）
        uint256 rewardId = uint256(keccak256(abi.encodePacked(_assetId, _airdropId, _recipient, block.timestamp)));
        
        // 報酬情報を設定
        rewards[_assetId][rewardId] = Reward({
            userAddress: _recipient,
            amount: _amount,
            tokenId: _tokenId,
            claimed: false
        });
        
        // AirdropIDとの関連付け
        rewardAirdropIds[rewardId] = _airdropId;
        
        // 報酬パラメータのコミットメントを計算
        bytes32 commitment = keccak256(abi.encodePacked(
            _recipient,
            _amount,
            _tokenId
        ));
        
        // コミットメントを保存
        rewardCommitments[_assetId][rewardId] = commitment;
        
        emit RewardRegistered(_assetId, _airdropId, rewardId, _recipient, _amount, _tokenId);
        emit RewardCommitmentSet(_assetId, rewardId, commitment);
        
        return rewardId;
    }
    
    /**
     * @dev 特定の報酬が既に請求済みかどうかを確認
     * @param _assetId アセットID
     * @param _rewardId 報酬ID
     * @return claimed 請求済みかどうか
     */
    function isRewardClaimed(uint256 _assetId, uint256 _rewardId) public view returns (bool) {
        uint256 bucket = _rewardId / 256;
        uint256 index = _rewardId % 256;
        return (claimedBitmap[_assetId][bucket] & (1 << index)) != 0;
    }
    
    /**
     * @dev 報酬を請求済みとしてマーク（内部関数）
     * @param _assetId アセットID
     * @param _rewardId 報酬ID
     */
    function _markRewardClaimed(uint256 _assetId, uint256 _rewardId) internal {
        uint256 bucket = _rewardId / 256;
        uint256 index = _rewardId % 256;
        claimedBitmap[_assetId][bucket] |= (1 << index);
    }
    
    /**
     * @dev 署名の検証（内部関数）
     * @param _chainId チェーンID
     * @param _userAddress ユーザーアドレス
     * @param _assetId アセットID
     * @param _rewardId 報酬ID
     * @param _nonce ノンス
     * @param _timestamp タイムスタンプ
     * @param _signature 署名
     * @return 検証結果
     */
    function _verifySignature(
        uint256 _chainId,
        address _userAddress,
        uint256 _assetId,
        uint256 _rewardId,
        uint256 _nonce,
        uint256 _timestamp,
        bytes calldata _signature
    ) internal view returns (bool) {
        bytes32 messageHash = keccak256(abi.encodePacked(
            _chainId,
            _userAddress,
            _assetId,
            _rewardId,
            _nonce,
            _timestamp
        ));
        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address recoveredAddress = ethSignedMessageHash.recover(_signature);
        return recoveredAddress == verifier;
    }
    
    /**
     * @dev トークンの転送処理（内部関数）
     * @param _asset アセット情報
     * @param _provider 提供者アドレス
     * @param _recipient 受取人アドレス
     * @param _amount 数量
     * @param _tokenId トークンID
     */
    function _transferToken(
        Asset storage _asset,
        address _provider,
        address _recipient,
        uint256 _amount,
        uint256 _tokenId
    ) internal {
        if (_asset.assetType == AssetType.ERC20) {
            require(
                IERC20(_asset.tokenAddress).transferFrom(_provider, _recipient, _amount),
                "ERC20 transfer failed"
            );
        } else if (_asset.assetType == AssetType.ERC721) {
            IERC721(_asset.tokenAddress).safeTransferFrom(_provider, _recipient, _tokenId);
        } else if (_asset.assetType == AssetType.ERC1155) {
            IERC1155(_asset.tokenAddress).safeTransferFrom(
                _provider,
                _recipient,
                _tokenId,
                _amount,
                ""
            );
        }
    }
    
    /**
     * @dev 報酬の請求処理（タイムスタンプ付き署名）
     * @param _chainId チェーンID
     * @param _assetId アセットID
     * @param _rewardId 報酬ID
     * @param _nonce ユーザーのノンス
     * @param _timestamp 署名が生成されたタイムスタンプ
     * @param _signature バックエンドの署名
     * @param _amount 数量（コミットメント検証用）
     * @param _tokenId トークンID（コミットメント検証用）
     */
    function claimReward(
        uint256 _chainId,
        uint256 _assetId,
        uint256 _rewardId,
        uint256 _nonce,
        uint256 _timestamp,
        bytes calldata _signature,
        uint256 _amount,
        uint256 _tokenId
    ) external nonReentrant whenNotPaused {
        require(_nonce == nonces[msg.sender], "Invalid nonce");
        
        // タイムスタンプの有効期限チェック
        require(_timestamp + signatureExpiryDuration >= block.timestamp, "Signature expired");
        
        // 既に請求済みでないことを確認
        require(!isRewardClaimed(_assetId, _rewardId), "Reward already claimed");
        
        // Airdropの有効性をチェック（AirdropRegistryが設定されている場合）
        if (airdropRegistry != address(0)) {
            uint256 airdropId = rewardAirdropIds[_rewardId];
            (bool isValid, ) = IAirdropRegistry(airdropRegistry).isAirdropValid(airdropId);
            require(isValid, "Airdrop is not valid");
        }
        
        // 署名検証
        require(_verifySignature(_chainId, msg.sender, _assetId, _rewardId, _nonce, _timestamp, _signature), "Invalid signature");
        
        // アセット存在確認
        Asset storage asset = assets[_assetId];
        require(asset.tokenAddress != address(0), "Asset does not exist");
        require(asset.isActive, "Asset is not active");
        
        // 報酬情報取得（署名によって検証済みなので、バックエンドに存在する）
        Reward storage reward = rewards[_assetId][_rewardId];
        
        // コミットメントの検証（設定されている場合）
        bytes32 commitment = rewardCommitments[_assetId][_rewardId];
        if (commitment != bytes32(0)) {
            bytes32 claimCommitment = keccak256(abi.encodePacked(
                msg.sender,
                _amount,
                _tokenId
            ));
            require(claimCommitment == commitment, "Invalid reward parameters");
        }
        
        // 報酬が既に設定されていない場合は、バックエンドが署名した情報に基づき受取人と金額が正しいと判断
        if (reward.userAddress == address(0)) {
            reward.userAddress = msg.sender;
            reward.amount = _amount;
            reward.tokenId = _tokenId;
            reward.claimed = false;
        } else {
            // 報酬が既に設定されている場合は、受取人確認
            require(reward.userAddress == msg.sender, "Not the reward recipient");
            require(reward.amount == _amount, "Amount mismatch");
            require(reward.tokenId == _tokenId, "TokenId mismatch");
        }
        
        // ノンスのインクリメント
        nonces[msg.sender]++;
        
        // 報酬を取得済みとしてマーク
        _markRewardClaimed(_assetId, _rewardId);
        reward.claimed = true;
        
        // トークン転送
        _transferToken(asset, asset.provider, msg.sender, reward.amount, reward.tokenId);
        
        // イベント発行
        emit RewardClaimed(
            _chainId,
            msg.sender,
            _assetId,
            _rewardId
        );
    }
    
    /**
     * @dev 複数報酬の一括請求（ガス最適化）
     * @param _params 請求パラメータの配列
     * @param _nonce ユーザーの現在のノンス
     * @notice 同一のAirdropの報酬のみをバッチ処理できます
     */
    function claimRewardBatch(
        ClaimParams[] calldata _params,
        uint256 _nonce
    ) external nonReentrant whenNotPaused {
        require(_params.length > 0, "Empty params array");
        require(_nonce == nonces[msg.sender], "Invalid nonce");
        
        // ユーザーのノンスをインクリメント（一度だけ）
        nonces[msg.sender]++;
        
        // 正常に処理された請求の数をカウント
        uint256 successfulClaims = 0;
        
        // Airdropの有効性チェック用の変数
        uint256 lastAirdropId = 0;
        bool airdropChecked = false;
        
        for (uint256 i = 0; i < _params.length; i++) {
            ClaimParams calldata param = _params[i];
            
            // 既にチェック済みのパラメータはスキップ
            if (isRewardClaimed(param.assetId, param.rewardId)) continue;
            
            // タイムスタンプの有効期限チェック
            if (param.timestamp + signatureExpiryDuration < block.timestamp) continue;
            
            // Airdropの有効性をチェック（必要な場合のみ）
            uint256 currentAirdropId = rewardAirdropIds[param.rewardId];
            if (airdropRegistry != address(0)) {
                // 異なるAirdropIDの場合のみチェックを実行
                if (!airdropChecked || lastAirdropId != currentAirdropId) {
                    (bool isValid, ) = IAirdropRegistry(airdropRegistry).isAirdropValid(currentAirdropId);
                    if (!isValid) continue; // 無効なAirdropの報酬はスキップ
                    
                    lastAirdropId = currentAirdropId;
                    airdropChecked = true;
                }
            }
            
            // 署名検証
            if (!_verifySignature(param.chainId, msg.sender, param.assetId, param.rewardId, _nonce, param.timestamp, param.signature)) {
                continue; // 無効な署名はスキップ
            }
            
            // アセット存在確認
            Asset storage asset = assets[param.assetId];
            if (asset.tokenAddress == address(0) || !asset.isActive) continue;
            
            // 報酬情報取得と検証
            Reward storage reward = rewards[param.assetId][param.rewardId];
            
            // コミットメントの検証（設定されている場合）
            bytes32 commitment = rewardCommitments[param.assetId][param.rewardId];
            if (commitment != bytes32(0)) {
                bytes32 claimCommitment = keccak256(abi.encodePacked(
                    msg.sender,
                    param.amount,
                    param.tokenId
                ));
                if (claimCommitment != commitment) continue; // コミットメント不一致はスキップ
            }
            
            // 報酬が既に設定されていない場合は、バックエンドが署名した情報を使用
            if (reward.userAddress == address(0)) {
                reward.userAddress = msg.sender;
                reward.amount = param.amount;
                reward.tokenId = param.tokenId;
                reward.claimed = false;
            } else {
                // 報酬が既に設定されている場合は、受取人と金額のチェック
                if (reward.userAddress != msg.sender || 
                    reward.amount != param.amount || 
                    reward.tokenId != param.tokenId) {
                    continue; // 不一致はスキップ
                }
            }
            
            // 報酬を取得済みとしてマーク
            _markRewardClaimed(param.assetId, param.rewardId);
            reward.claimed = true;
            
            // トークン転送
            try {
                _transferToken(asset, asset.provider, msg.sender, reward.amount, reward.tokenId);
                successfulClaims++;
                
                // 個別の報酬請求イベントを発行
                emit RewardClaimed(
                    param.chainId,
                    msg.sender,
                    param.assetId,
                    param.rewardId
                );
            } catch {
                // トークン転送に失敗した場合はこの報酬をスキップし、次へ進む
                // 請求済みマークは戻さないため、再請求は不可能（エラーの原因によってはバックエンドで処理が必要）
                continue;
            }
        }
        
        // バッチ処理の結果をイベントとして発行
        require(successfulClaims > 0, "No rewards claimed successfully");
        emit BatchRewardClaimed(msg.sender, successfulClaims);
    }
    
    /**
     * @dev バックエンドからの報酬設定（オプション - システム設計によっては不要）
     * @param _assetId アセットID
     * @param _rewardId 報酬ID
     * @param _airdropId AirdropID
     * @param _recipient 受取人アドレス
     * @param _amount 数量
     * @param _tokenId トークンID
     */
    function setReward(
        uint256 _assetId,
        uint256 _rewardId,
        uint256 _airdropId,
        address _recipient,
        uint256 _amount,
        uint256 _tokenId
    ) external whenNotPaused {
        require(msg.sender == owner() || operators[msg.sender] || msg.sender == verifier, "Unauthorized");
        require(assets[_assetId].tokenAddress != address(0), "Asset does not exist");
        require(_recipient != address(0), "Invalid recipient");
        require(rewards[_assetId][_rewardId].userAddress == address(0), "Reward already exists");
        
        rewards[_assetId][_rewardId] = Reward({
            userAddress: _recipient,
            amount: _amount,
            tokenId: _tokenId,
            claimed: false
        });
        
        // AirdropIDとの関連付け
        rewardAirdropIds[_rewardId] = _airdropId;
        
        // コミットメントも設定
        bytes32 commitment = keccak256(abi.encodePacked(
            _recipient,
            _amount,
            _tokenId
        ));
        
        rewardCommitments[_assetId][_rewardId] = commitment;
        emit RewardCommitmentSet(_assetId, _rewardId, commitment);
        emit RewardRegistered(_assetId, _airdropId, _rewardId, _recipient, _amount, _tokenId);
    }
    
    /**
     * @dev ユーザーの現在のノンス取得
     * @param _user ユーザーアドレス
     * @return nonce 現在のノンス値
     */
    function getNonce(address _user) external view returns (uint256) {
        return nonces[_user];
    }
    
    /**
     * @dev 緊急停止
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @dev 緊急停止解除
     */
    function unpause() external onlyOwner {
        _unpause();
    }
}