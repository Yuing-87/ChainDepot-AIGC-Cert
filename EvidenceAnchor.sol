// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title EvidenceAnchor
 * @notice 侵权证据固定合约
 * @dev    检测命中后，将「取证截图指纹 + 检测报告哈希 + 相似度结论」二次上链固定，
 *         形成从 侵权内容 → 检测报告 → 链上存证 的完整证据链。报告原文存 IPFS（仅 CID 上链）。
 */
contract EvidenceAnchor is Ownable, ReentrancyGuard {
    struct Evidence {
        uint256 id;
        address reporter;
        uint256 workId; // 被侵权作品的链上存证 id（0 = 未关联存证）
        bytes32 contentHash; // 侵权内容 SHA-256
        bytes32 reportHash; // 检测报告 JSON 的 SHA-256
        string ipfsCid; // 报告原文 IPFS CID
        uint16 simScore; // 相似度结论 0-10000（basis points）
        uint256 anchoredAt;
    }

    uint256 public evidenceSeq;
    bool public openAnchoring = true;

    /// @notice 报告哈希 -> evidence id（防重复固定）
    mapping(bytes32 => uint256) public idByReportHash;
    /// @notice evidence id -> Evidence
    mapping(uint256 => Evidence) public evidenceById;
    /// @notice 被授权允许固定证据的监测机构（开放模式下可为空）
    mapping(address => bool) public authorizedReporters;

    event EvidenceAnchored(
        uint256 indexed id,
        address indexed reporter,
        uint256 indexed workId,
        bytes32 contentHash,
        bytes32 reportHash,
        string ipfsCid,
        uint16 simScore,
        uint256 anchoredAt
    );
    event ReporterAuthorized(address indexed reporter, bool authorized);
    event AnchoringModeChanged(bool open);

    error UnauthorizedReporter();
    error DuplicateReport();
    error EmptyReportHash();
    error InvalidScore();

    constructor() Ownable(msg.sender) {}

    modifier onlyReporter() {
        if (!openAnchoring && !authorizedReporters[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedReporter();
        }
        _;
    }

    /**
     * @notice 固定一条侵权证据（开放模式任意地址可调用；受限模式仅授权机构）
     * @param workId      被侵权作品存证 id
     * @param contentHash 侵权内容 SHA-256
     * @param reportHash  检测报告 JSON 的 SHA-256
     * @param ipfsCid     报告原文 IPFS CID
     * @param simScore    相似度结论，万分制（10000 = 完全相同）
     */
    function anchorEvidence(
        uint256 workId,
        bytes32 contentHash,
        bytes32 reportHash,
        string calldata ipfsCid,
        uint16 simScore
    ) external nonReentrant onlyReporter returns (uint256) {
        if (reportHash == bytes32(0)) revert EmptyReportHash();
        if (idByReportHash[reportHash] != 0) revert DuplicateReport();
        if (simScore > 10000) revert InvalidScore();

        uint256 id = ++evidenceSeq;
        evidenceById[id] = Evidence({
            id: id,
            reporter: msg.sender,
            workId: workId,
            contentHash: contentHash,
            reportHash: reportHash,
            ipfsCid: ipfsCid,
            simScore: simScore,
            anchoredAt: block.timestamp
        });
        idByReportHash[reportHash] = id;

        emit EvidenceAnchored(id, msg.sender, workId, contentHash, reportHash, ipfsCid, simScore, block.timestamp);
        return id;
    }

    /// @notice 校验某份检测报告是否已固定上链
    function verifyEvidence(bytes32 reportHash) external view returns (bool exists, uint256 id) {
        id = idByReportHash[reportHash];
        exists = id != 0;
    }

    /// @notice 查询指定编号的证据
    function getEvidence(uint256 id) external view returns (Evidence memory) {
        return evidenceById[id];
    }

    function getEvidenceCount() external view returns (uint256) {
        return evidenceSeq;
    }

    /* ======================= 管理（Ownable） ======================= */

    function setOpenAnchoring(bool open) external onlyOwner {
        openAnchoring = open;
        emit AnchoringModeChanged(open);
    }

    function authorizeReporter(address reporter, bool authorized) external onlyOwner {
        authorizedReporters[reporter] = authorized;
        emit ReporterAuthorized(reporter, authorized);
    }
}
