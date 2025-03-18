// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

/**
 * @title RewardDistributorProxyAdmin
 * @dev 報酬配布システムのプロキシを管理するためのコントラクト
 * 単一管理者による簡易版
 */
contract RewardDistributorProxyAdmin is ProxyAdmin {
    /**
     * @dev コンストラクタ
     * オーナーには管理者アドレスが設定される
     */
    constructor() {
        // デフォルトの管理者は deployer
    }
}