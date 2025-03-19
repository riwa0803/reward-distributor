// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title RewardDistributorProxy
 * @dev RewardDistributor コントラクトのプロキシ
 * UUPSアップグレード可能なプロキシパターンを使用
 * ProxyAdmin コントラクトが実際の管理を行う
 */
contract RewardDistributorProxy is ERC1967Proxy {
    /**
     * @dev コンストラクタ
     * @param _implementation 初期実装コントラクトのアドレス
     * @param _data 初期化データ（initialize関数の呼び出し）
     * @param _admin プロキシ管理者アドレス（ProxyAdminコントラクト）
     */
    constructor(
        address _implementation,
        bytes memory _data,
        address _admin
    ) ERC1967Proxy(_implementation, _data) {
        // プロキシ管理者を設定
        // これにより、_admin アドレス（ProxyAdmin コントラクト）のみが
        // このプロキシのアップグレードとプロキシ関連の管理機能を呼び出せるようになる
        assembly {
            sstore(0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103, _admin)
        }
    }
}