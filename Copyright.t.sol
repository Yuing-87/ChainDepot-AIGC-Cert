// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CopyrightVault} from "../src/CopyrightVault.sol";
import {EvidenceAnchor} from "../src/EvidenceAnchor.sol";

contract CopyrightVaultTest is Test {
    CopyrightVault vault;
    EvidenceAnchor anchor;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    bytes32 H1 = keccak256("content-a");
    bytes32 P1 = keccak256("phash-a");
    bytes32 H2 = keccak256("content-b");

    function setUp() public {
        vault = new CopyrightVault();
        anchor = new EvidenceAnchor();
    }

    function test_RegisterWork() public {
        vm.prank(alice);
        uint256 id = vault.registerWork(CopyrightVault.WorkKind.Image, H1, P1, "海雾夜航", "Stable Diffusion XL", "QmX", 1700000000);
        assertEq(id, 1);
        (uint256 wid, address author,, bytes32 ch,, string memory title,,, ,) = vault.works(id);
        assertEq(wid, 1);
        assertEq(author, alice);
        assertEq(ch, H1);
        assertEq(title, "海雾夜航");
    }

    function test_RevertDuplicateHash() public {
        vm.prank(alice);
        vault.registerWork(CopyrightVault.WorkKind.Image, H1, P1, "a", "m", "c1", 1);
        vm.prank(alice);
        vm.expectRevert(CopyrightVault.AlreadyRegistered.selector);
        vault.registerWork(CopyrightVault.WorkKind.Image, H1, P1, "a2", "m", "c2", 2);
    }

    function test_VerifyByHash() public {
        vm.prank(alice);
        vault.registerWork(CopyrightVault.WorkKind.Text, H2, P1, "随笔", "GPT-4o", "QmY", 1);
        (bool ok, uint256 id) = vault.verifyByHash(H2);
        assertTrue(ok);
        assertEq(id, 1);
        (bool bad,) = vault.verifyByHash(keccak256("nope"));
        assertFalse(bad);
    }

    function test_VersionChainAndGuard() public {
        vm.prank(alice);
        uint256 root = vault.registerWork(CopyrightVault.WorkKind.Image, H1, P1, "首版", "m", "c1", 1);
        bytes32 H3 = keccak256("content-v2");
        vm.prank(alice);
        uint256 v2 = vault.registerVersion(root, CopyrightVault.WorkKind.Image, H3, P1, "二版", "m", "c2", 2);
        assertEq(v2, 2);

        uint256[] memory chain = vault.getVersionChain(root);
        assertEq(chain.length, 2);
        assertEq(chain[0], root);
        assertEq(chain[1], v2);

        // 非作者不能登记版本
        vm.prank(bob);
        vm.expectRevert(CopyrightVault.NotAuthor.selector);
        vault.registerVersion(root, CopyrightVault.WorkKind.Image, keccak256("x"), P1, "x", "m", "c", 3);

        // 版本不可再挂版本（parentId 必须为根）
        vm.prank(alice);
        vm.expectRevert(CopyrightVault.NotAuthor.selector);
        vault.registerVersion(v2, CopyrightVault.WorkKind.Image, keccak256("y"), P1, "y", "m", "c", 4);
    }

    function test_AuthorizationFlow() public {
        vm.prank(alice);
        uint256 id = vault.registerWork(CopyrightVault.WorkKind.Image, H1, P1, "作品", "m", "c", 1);

        vm.prank(alice);
        uint256 gid = vault.grantAuthorization(id, bob, CopyrightVault.LicenseScope.Commercial, 2000000000);
        assertEq(gid, 1);

        (, , CopyrightVault.LicenseScope scope,, , bool active) = vault.grants(id, bob);
        assertEq(uint8(scope), uint8(CopyrightVault.LicenseScope.Commercial));
        assertTrue(active);

        // 非作者不可授权 / 撤销
        vm.prank(bob);
        vm.expectRevert(CopyrightVault.NotAuthor.selector);
        vault.revokeAuthorization(id, bob);

        vm.prank(alice);
        vault.revokeAuthorization(id, bob);
        (, , , , , bool activeAfter) = vault.grants(id, bob);
        assertFalse(activeAfter);
    }

    function test_PauseByOwner() public {
        vm.prank(alice);
        vault.registerWork(CopyrightVault.WorkKind.Text, H2, P1, "x", "m", "c", 1);
        vault.pause();
        vm.prank(alice);
        vm.expectRevert(CopyrightVault.ContractPaused.selector);
        vault.registerWork(CopyrightVault.WorkKind.Text, keccak256("zz"), P1, "y", "m", "c", 2);
        vault.unpause();
        vm.prank(alice);
        vault.registerWork(CopyrightVault.WorkKind.Text, keccak256("zz"), P1, "y", "m", "c", 2);
    }
}

contract EvidenceAnchorTest is Test {
    EvidenceAnchor anchor;
    address reporter = makeAddr("monitor");
    bytes32 RH = keccak256("report-json-1");

    function setUp() public {
        anchor = new EvidenceAnchor();
    }

    function test_AnchorEvidence() public {
        vm.prank(reporter);
        uint256 id = anchor.anchorEvidence(3, keccak256("bad"), RH, "QmZ", 9200);
        assertEq(id, 1);
        (uint256 eid,, uint256 workId, bytes32 ch, bytes32 rch, string memory cid, uint16 sim,) = anchor.evidenceById(id);
        assertEq(eid, 1);
        assertEq(workId, 3);
        assertEq(ch, keccak256("bad"));
        assertEq(rch, RH);
        assertEq(cid, "QmZ");
        assertEq(sim, 9200);

        (bool ok,) = anchor.verifyEvidence(RH);
        assertTrue(ok);
    }

    function test_DuplicateReportReverts() public {
        vm.prank(reporter);
        anchor.anchorEvidence(1, keccak256("b"), RH, "c", 8000);
        vm.prank(reporter);
        vm.expectRevert(EvidenceAnchor.DuplicateReport.selector);
        anchor.anchorEvidence(1, keccak256("b"), RH, "c2", 9000);
    }

    function test_RestrictedAnchoring() public {
        anchor.setOpenAnchoring(false);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(EvidenceAnchor.UnauthorizedReporter.selector);
        anchor.anchorEvidence(0, keccak256("x"), keccak256("r2"), "c", 5000);

        vm.startPrank(anchor.owner());
        anchor.authorizeReporter(reporter, true);
        vm.stopPrank();
        vm.prank(reporter);
        anchor.anchorEvidence(0, keccak256("x"), keccak256("r2"), "c", 5000);
    }
}
