// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CopyrightVault
 * @notice AIGC 内容版权存证合约
 * @dev    为 AI 生成作品提供链上确权：作品元数据 + SHA-256 精确哈希 + 感知指纹写入链上；
 *         支持版本链追溯（registerVersion）与授权登记（grantAuthorization / revokeAuthorization）。
 *         原文本身永不上链（隐私设计），仅存 IPFS CID 与不可逆指纹，任何人都可通过 verifyByHash 校验真伪。
 */
contract CopyrightVault is Ownable, ReentrancyGuard {
    enum WorkKind { Unset, Image, Text }

    enum LicenseScope { Unset, Commercial, Repost, Remix, AllRights }

    struct Work {
        uint256 id;
        address author;
        WorkKind kind;
        bytes32 contentHash; // SHA-256(original bytes) —— 精确匹配指纹
        bytes32 perceptualHash; // pHash / SimHash —— 感知粗筛指纹
        string title;
        string model; // 生成模型，如 Midjourney v6 / GPT-4o
        string ipfsCid; // 原文 IPFS CID（含元数据 JSON）
        uint256 createdTime; // AIGC 生成时间（unix）
        uint256 anchoredAt; // 上链时间（block.timestamp）
        uint256 parentId; // 版本链父 ID，0 = 首版
    }

    struct Grant {
        address grantor;
        address grantee;
        LicenseScope scope;
        uint256 expiresAt; // unix，0 = 永久
        uint256 grantedAt;
        bool active;
    }

    uint256 public workSeq;
    uint256 public grantSeq;
    bool public paused;

    /// @notice contentHash -> work id（同一内容禁止重复存证）
    mapping(bytes32 => uint256) public idByHash;
    /// @notice work id -> Work
    mapping(uint256 => Work) public works;
    /// @notice author -> 其名下作品 id 列表
    mapping(address => uint256[]) private worksOf;
    /// @notice 根作品 id -> 全版本链（含根，按登记顺序）
    mapping(uint256 => uint256[]) private versionChainOf;
    /// @notice work id -> grantee -> Grant
    mapping(uint256 => mapping(address => Grant)) public grants;

    event WorkRegistered(
        uint256 indexed id,
        address indexed author,
        WorkKind indexed kind,
        bytes32 contentHash,
        bytes32 perceptualHash,
        string title,
        string model,
        string ipfsCid,
        uint256 createdTime,
        uint256 anchoredAt
    );
    event VersionRegistered(uint256 indexed newId, uint256 indexed parentId, address indexed author);
    event AuthorizationGranted(
        uint256 indexed grantId,
        uint256 indexed workId,
        address indexed grantor,
        address grantee,
        LicenseScope scope,
        uint256 expiresAt,
        uint256 grantedAt
    );
    event AuthorizationRevoked(uint256 indexed workId, address indexed grantee);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    error NotAuthor();
    error WorkNotFound();
    error AlreadyRegistered();
    error EmptyFingerprint();
    error InvalidScope();
    error GrantAlreadyActive();
    error NotGrantor();
    error ContractPaused();

    constructor() Ownable(msg.sender) {}

    modifier whenActive() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier onlyAuthorOf(uint256 workId) {
        if (works[workId].author != msg.sender) revert NotAuthor();
        _;
    }

    /* ======================= 存证登记 ======================= */

    /**
     * @notice 登记一件新的 AIGC 作品（首版）
     */
    function registerWork(
        WorkKind kind,
        bytes32 contentHash,
        bytes32 perceptualHash,
        string calldata title,
        string calldata model,
        string calldata ipfsCid,
        uint256 createdTime
    ) external nonReentrant whenActive returns (uint256) {
        return _register(kind, contentHash, perceptualHash, title, model, ipfsCid, createdTime, 0);
    }

    /**
     * @notice 为既有作品登记迭代版本，自动归入同一版本链
     */
    function registerVersion(
        uint256 parentId,
        WorkKind kind,
        bytes32 contentHash,
        bytes32 perceptualHash,
        string calldata title,
        string calldata model,
        string calldata ipfsCid,
        uint256 createdTime
    ) external nonReentrant whenActive onlyAuthorOf(parentId) returns (uint256) {
        if (works[parentId].parentId != 0) revert NotAuthor(); // 仅允许挂到根版本
        uint256 newId =
            _register(kind, contentHash, perceptualHash, title, model, ipfsCid, createdTime, parentId);
        emit VersionRegistered(newId, parentId, msg.sender);
        return newId;
    }

    function _register(
        WorkKind kind,
        bytes32 contentHash,
        bytes32 perceptualHash,
        string calldata title,
        string calldata model,
        string calldata ipfsCid,
        uint256 createdTime,
        uint256 parentId
    ) internal returns (uint256) {
        if (kind == WorkKind.Unset) revert InvalidScope();
        if (contentHash == bytes32(0) || perceptualHash == bytes32(0)) revert EmptyFingerprint();
        if (idByHash[contentHash] != 0) revert AlreadyRegistered();

        uint256 id = ++workSeq;
        works[id] = Work({
            id: id,
            author: msg.sender,
            kind: kind,
            contentHash: contentHash,
            perceptualHash: perceptualHash,
            title: title,
            model: model,
            ipfsCid: ipfsCid,
            createdTime: createdTime,
            anchoredAt: block.timestamp,
            parentId: parentId
        });
        idByHash[contentHash] = id;
        worksOf[msg.sender].push(id);
        uint256 rootId = parentId == 0 ? id : parentId;
        versionChainOf[rootId].push(id);

        emit WorkRegistered(
            id, msg.sender, kind, contentHash, perceptualHash, title, model, ipfsCid, createdTime, block.timestamp
        );
        return id;
    }

    /* ======================= 授权管理 ======================= */

    /**
     * @notice 著作权人授予他人 商用 / 转载 / 改编 授权
     */
    function grantAuthorization(
        uint256 workId,
        address grantee,
        LicenseScope scope,
        uint256 expiresAt
    ) external nonReentrant onlyAuthorOf(workId) returns (uint256) {
        if (scope == LicenseScope.Unset) revert InvalidScope();
        Grant storage g = grants[workId][grantee];
        if (g.active) revert GrantAlreadyActive();

        uint256 grantId = ++grantSeq;
        g.grantor = msg.sender;
        g.grantee = grantee;
        g.scope = scope;
        g.expiresAt = expiresAt;
        g.grantedAt = block.timestamp;
        g.active = true;

        emit AuthorizationGranted(grantId, workId, msg.sender, grantee, scope, expiresAt, block.timestamp);
        return grantId;
    }

    function revokeAuthorization(uint256 workId, address grantee) external nonReentrant onlyAuthorOf(workId) {
        Grant storage g = grants[workId][grantee];
        if (g.grantor != msg.sender) revert NotGrantor();
        g.active = false;
        emit AuthorizationRevoked(workId, grantee);
    }

    /* ======================= 查询校验 ======================= */

    /// @notice 任何人可校验某内容指纹是否已存证（先本地算 SHA-256 再上链比对）
    function verifyByHash(bytes32 contentHash) external view returns (bool registered, uint256 id) {
        id = idByHash[contentHash];
        registered = id != 0;
    }

    /// @notice 获取某作者全部作品 id
    function getAuthorWorkIds(address author) external view returns (uint256[] memory) {
        return worksOf[author];
    }

    /// @notice 获取版本链（rootId 作品及其全部后代）
    function getVersionChain(uint256 rootId) external view returns (uint256[] memory) {
        if (versionChainOf[rootId].length == 0 && works[rootId].id != 0) {
            uint256[] memory single = new uint256[](1);
            single[0] = rootId;
            return single;
        }
        return versionChainOf[rootId];
    }

    function totalWorks() external view returns (uint256) {
        return workSeq;
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }
}
