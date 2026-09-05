// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {CopyrightVault} from "../src/CopyrightVault.sol";
import {EvidenceAnchor} from "../src/EvidenceAnchor.sol";

/// @notice 一键部署两个合约到本地链
/// @dev    forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <key>
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);

        CopyrightVault vault = new CopyrightVault();
        EvidenceAnchor anchor = new EvidenceAnchor();

        vm.stopBroadcast();

        console2.log("CopyrightVault :", address(vault));
        console2.log("EvidenceAnchor :", address(anchor));
    }
}
