// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SystemDeployer} from "./SystemDeployer.sol";

/// @notice Deploys the baseline + protected systems to a LOCAL anvil chain for the demo.
/// Uses anvil's public default test keys (never use these on a real network).
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
/// Writes deployments/<chainId>.json for the demo runner.
contract Deploy is Script, SystemDeployer {
    // anvil default accounts (public test keys)
    uint256 internal constant ADMIN_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // #0
    address internal constant FEEDER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8; // #1
    address internal constant ALICE = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC; // #2 existing borrower
    address internal constant MALLORY = 0x90F79bf6EB2c4f870365E785982E1f101E93b906; // #3 attacker
    address internal constant BOB = 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65; // #4 new borrower

    function run() external returns (System memory sys) {
        require(block.chainid == 31337, "Deploy: local anvil only (uses public test keys)");
        address admin = vm.addr(ADMIN_KEY);

        // ASO sources: anvil accounts #5..#9, ascending by address
        address[] memory signers = new address[](5);
        signers[0] = 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955; // #7
        signers[1] = 0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f; // #8
        signers[2] = 0x976EA74026E726554dB657fA54763abd0C3a0aa9; // #6
        signers[3] = 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc; // #5
        signers[4] = 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720; // #9

        vm.startBroadcast(ADMIN_KEY);
        sys = _deploySystem(defaultConfig(), admin, FEEDER, admin, signers);
        sys.gem.mint(ALICE, 1_000e18);
        sys.gem.mint(MALLORY, 1_000e18);
        sys.gem.mint(BOB, 1_000e18);
        sys.osm.kiss(admin); // lets the demo read the OSM value it serves (read-only whitelist)
        vm.stopBroadcast();

        _write(sys);
    }

    function _write(System memory sys) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeBytes32(k, "ilk", ILK);
        vm.serializeBytes32(k, "profileId", PROFILE_ID);
        vm.serializeAddress(k, "gem", address(sys.gem));
        vm.serializeAddress(k, "feed", address(sys.feed));
        vm.serializeAddress(k, "adapter", address(sys.adapter));
        vm.serializeAddress(k, "osm", address(sys.osm));
        vm.serializeAddress(k, "baselineVat", address(sys.baseline.vat));
        vm.serializeAddress(k, "baselineSpotter", address(sys.baseline.spotter));
        vm.serializeAddress(k, "baselineJoin", address(sys.baseline.join));
        vm.serializeAddress(k, "protectedVat", address(sys.protectedStack.vat));
        vm.serializeAddress(k, "protectedSpotter", address(sys.protectedStack.spotter));
        vm.serializeAddress(k, "protectedJoin", address(sys.protectedStack.join));
        vm.serializeAddress(k, "verifier", address(sys.verifier));
        string memory json = vm.serializeAddress(k, "sentinel", address(sys.sentinel));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        console2.log("Deployment written to deployments/%s.json", vm.toString(block.chainid));
    }
}
