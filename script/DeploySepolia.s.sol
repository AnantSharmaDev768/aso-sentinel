// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SystemDeployer} from "./SystemDeployer.sol";

/// @notice Deploys baseline + protected Multipli stacks to Ethereum Sepolia (chainId 11155111).
///
/// SAFETY GUARDS:
///   1. Strict chainId check: Reverts immediately if block.chainid != 11155111.
///   2. Mainnet prohibition: Reverts immediately if block.chainid == 1.
///   3. Zero private key exposure: Broadcaster is resolved via vm.startBroadcast().
///   4. Timing calibration: Exactly one Sepolia profile (osmHop=60s, maxAge=300s, maxValidity=600s).
///      Adapter maxDelay remains 24h (stale-feed scenario is anvil-only).
///   5. Role separation: Reads RELAYER from env, sets feeder = RELAYER, and mints 1,000 mPAXG to RELAYER.
///   6. Source signers: Reads 5 pre-generated ascending addresses from ASO_SIGNERS env var.
///   7. Anvil Denylist: Reverts if any signer or relayer equals an Anvil public default account (#0-#9).
///
/// Dry-run simulation:
///   forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC_URL
///
/// Broadcast deployment:
///   forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $SEPOLIA_DEPLOYER_KEY --broadcast --verify --verifier sourcify
contract DeploySepolia is Script, SystemDeployer {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev Anvil default test accounts (#0-#9) - strictly forbidden on Sepolia
    function _isAnvilDefault(address a) internal pure returns (bool) {
        return a == 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 // #0
            || a == 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 // #1
            || a == 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC // #2
            || a == 0x90F79bf6EB2c4f870365E785982E1f101E93b906 // #3
            || a == 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 // #4
            || a == 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc // #5
            || a == 0x976EA74026E726554dB657fA54763abd0C3a0aa9 // #6
            || a == 0x14dC79964da2C08b23698B3D3cc7Ca32193d9955 // #7
            || a == 0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f // #8
            || a == 0xa0Ee7A142d267C1f36714E4a8F75612F20a79720; // #9
    }

    /// @notice Single Sepolia profile: shortened timings calibrated for ~12-second block times.
    /// Everything else inherits from defaultConfig(). Adapter maxDelay remains 24h.
    function sepoliaConfig() internal pure returns (Config memory c) {
        c = defaultConfig();
        c.osmHop = 60; // 60s (1 minute) OSM delay
        c.maxAge = 300; // 300s (5 minutes) ASO freshness window
        c.maxValidity = 600; // 600s (10 minutes) max validity
    }

    function run() external returns (System memory sys) {
        // --- 1. HARD CHAIN GUARDS ---
        require(block.chainid == SEPOLIA_CHAIN_ID, "DeploySepolia: MUST be Sepolia (chainId 11155111)");
        require(block.chainid != 1, "DeploySepolia: MAINNET DEPLOYMENT FORBIDDEN");

        // --- 2. ENVIRONMENT & ROLE VALIDATION ---
        address relayer = vm.envAddress("RELAYER");
        require(relayer != address(0), "DeploySepolia: RELAYER address must not be zero");
        require(!_isAnvilDefault(relayer), "DeploySepolia: RELAYER cannot be an Anvil default account");

        address[] memory signers = vm.envAddress("ASO_SIGNERS", ",");
        require(signers.length == 5, "DeploySepolia: exactly 5 ASO_SIGNERS required");
        for (uint256 i = 0; i < signers.length; i++) {
            require(signers[i] != address(0), "DeploySepolia: signer cannot be zero address");
            require(!_isAnvilDefault(signers[i]), "DeploySepolia: signers cannot be Anvil default accounts");
            if (i > 0) {
                require(signers[i] > signers[i - 1], "DeploySepolia: ASO_SIGNERS must be strictly ascending");
            }
        }

        Config memory cfg = sepoliaConfig();

        // --- 3. BROADCAST & DEPLOY ---
        vm.startBroadcast();
        address deployer = msg.sender;
        require(!_isAnvilDefault(deployer), "DeploySepolia: deployer cannot be an Anvil default account");

        console2.log("Deploying to Sepolia (chainId %s)...", block.chainid);
        console2.log("Deployer (admin/guardian): %s", deployer);
        console2.log("Relayer (feeder/borrower): %s", relayer);
        console2.log("Signers: 5 ascending addresses configured from ASO_SIGNERS");

        // Deploy system: feeder = relayer, admin = deployer, guardian = deployer
        sys = _deploySystem(cfg, deployer, relayer, deployer, signers);

        // Mint 1,000 mPAXG to relayer so the runner can deposit and borrow
        sys.gem.mint(relayer, 1_000e18);

        // OSM read whitelisting (kiss)
        sys.osm.kiss(deployer);
        sys.osm.kiss(relayer);

        vm.stopBroadcast();

        // --- 4. WRITE DEPLOYMENT MANIFEST ---
        _write(sys, relayer, cfg);
        console2.log("Sepolia deployment complete. Manifest written to deployments/%s.json", vm.toString(block.chainid));
    }

    function _write(System memory sys, address relayer, Config memory cfg) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeBytes32(k, "ilk", ILK);
        vm.serializeBytes32(k, "profileId", PROFILE_ID);
        vm.serializeAddress(k, "relayer", relayer);
        vm.serializeUint(k, "osmHop", cfg.osmHop);
        vm.serializeUint(k, "maxAge", cfg.maxAge);
        vm.serializeUint(k, "maxValidity", cfg.maxValidity);
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
    }
}
