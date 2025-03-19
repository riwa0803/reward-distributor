// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title AirdropRegistry
 * @dev Airdropの情報を管理するコントラクト
 * アップグレード可能なプロキシパターンを採用
 */
contract AirdropRegistry is 
    Initializable, 
    UUPSUpgradeable, 
    OwnableUpgradeable,
    PausableUpgradeable {
    
    // Airdrop情報の構造体
    struct Airdrop {
        uint256 startDate;    // 開始日時（UNIXタイムスタンプ）
        uint256 endDate;      // 終了日時（UNIXタイムスタンプ）
        bool isActive;        // 有効状態
        address creator;      // 作成者
    }
    
    // AirdropIDからAirdrop情報へのマッピング
    mapping(uint256 => Airdrop) public airdrops;
    
    // オペレータ権限のマッピング
    mapping(address => bool) public operators;
    
    // イベント定義
    event AirdropRegistered(uint256 indexed airdropId, uint256 startDate, uint256 endDate, address creator);
    event AirdropPeriodUpdated(uint256 indexed airdropId, uint256 newStartDate, uint256 newEndDate);
    event AirdropStatusUpdated(uint256 indexed airdropId, bool isActive);
    event OperatorAdded(address indexed operator);
    event OperatorRemoved(address indexed operator);
    
    /**
     * @dev 初期化関数
     */
    function initialize() public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __Pausable_init();
    }
    
    /**
     * @dev アップグレード権限チェック
     * @param newImplementation 新しい実装コントラクトのアドレス
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
    
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
     * @dev Airdropの登録
     * @param _airdropId AirdropID
     * @param _startDate 開始日時
     * @param _endDate 終了日時
     * @return airdropId 登録されたAirdropのID
     */
    function registerAirdrop(
        uint256 _airdropId,
        uint256 _startDate,
        uint256 _endDate
    ) external whenNotPaused returns (uint256) {
        require(airdrops[_airdropId].creator == address(0), "Airdrop already exists");
        require(_endDate > _startDate, "End date must be after start date");
        require(_startDate >= block.timestamp, "Start date must be in the future");
        
        airdrops[_airdropId] = Airdrop({
            startDate: _startDate,
            endDate: _endDate,
            isActive: true,
            creator: msg.sender
        });
        
        emit AirdropRegistered(_airdropId, _startDate, _endDate, msg.sender);
        return _airdropId;
    }
    
    /**
     * @dev Airdrop期間の更新
     * @param _airdropId AirdropID
     * @param _newStartDate 新しい開始日時
     * @param _newEndDate 新しい終了日時
     */
    function updateAirdropPeriod(
        uint256 _airdropId,
        uint256 _newStartDate,
        uint256 _newEndDate
    ) external whenNotPaused {
        Airdrop storage airdrop = airdrops[_airdropId];
        require(airdrop.creator != address(0), "Airdrop does not exist");
        require(
            msg.sender == owner() || 
            operators[msg.sender] || 
            msg.sender == airdrop.creator, 
            "Unauthorized"
        );
        require(_newEndDate > _newStartDate, "End date must be after start date");
        
        airdrop.startDate = _newStartDate;
        airdrop.endDate = _newEndDate;
        
        emit AirdropPeriodUpdated(_airdropId, _newStartDate, _newEndDate);
    }
    
    /**
     * @dev Airdrop期限延長（終了日のみ更新）
     * @param _airdropId AirdropID
     * @param _newEndDate 新しい終了日時
     */
    function extendAirdropPeriod(
        uint256 _airdropId,
        uint256 _newEndDate
    ) external whenNotPaused {
        Airdrop storage airdrop = airdrops[_airdropId];
        require(airdrop.creator != address(0), "Airdrop does not exist");
        require(
            msg.sender == owner() || 
            operators[msg.sender] || 
            msg.sender == airdrop.creator, 
            "Unauthorized"
        );
        require(_newEndDate > airdrop.endDate, "New end date must be after current end date");
        
        airdrop.endDate = _newEndDate;
        
        emit AirdropPeriodUpdated(_airdropId, airdrop.startDate, _newEndDate);
    }
    
    /**
     * @dev Airdropのステータス更新（有効/無効）
     * @param _airdropId AirdropID
     * @param _isActive アクティブ状態
     */
    function updateAirdropStatus(
        uint256 _airdropId,
        bool _isActive
    ) external whenNotPaused {
        Airdrop storage airdrop = airdrops[_airdropId];
        require(airdrop.creator != address(0), "Airdrop does not exist");
        require(
            msg.sender == owner() || 
            operators[msg.sender] || 
            msg.sender == airdrop.creator, 
            "Unauthorized"
        );
        
        airdrop.isActive = _isActive;
        
        emit AirdropStatusUpdated(_airdropId, _isActive);
    }
    
    /**
     * @dev Airdropの有効確認
     * @param _airdropId AirdropID
     * @return isValid 有効かどうか
     * @return endDate 終了日時
     */
    function isAirdropValid(uint256 _airdropId) external view returns (bool isValid, uint256 endDate) {
        Airdrop storage airdrop = airdrops[_airdropId];
        
        // 存在・有効・期間内であるかをチェック
        isValid = airdrop.creator != address(0) &&
                 airdrop.isActive &&
                 block.timestamp >= airdrop.startDate &&
                 block.timestamp <= airdrop.endDate;
                 
        return (isValid, airdrop.endDate);
    }
    
    /**
     * @dev Airdrop情報の取得
     * @param _airdropId AirdropID
     * @return startDate 開始日時
     * @return endDate 終了日時
     * @return isActive アクティブ状態
     * @return creator 作成者
     */
    function getAirdropInfo(uint256 _airdropId) external view returns (
        uint256 startDate,
        uint256 endDate,
        bool isActive,
        address creator
    ) {
        Airdrop storage airdrop = airdrops[_airdropId];
        require(airdrop.creator != address(0), "Airdrop does not exist");
        
        return (
            airdrop.startDate,
            airdrop.endDate,
            airdrop.isActive,
            airdrop.creator
        );
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