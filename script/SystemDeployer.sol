// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {CommonBase} from "forge-std/Base.sol";
import {IVat, ISpotter, IOSM, IPriceFeedAdapter, IGemJoin} from "../src/interfaces/IMultipli.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";
import {ASOSentinel} from "../src/ASOSentinel.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";
import {MockRWA} from "../src/mocks/MockRWA.sol";

/// @notice Deploys, side by side and fed by the SAME price path:
///   feed (mock Chainlink) -> Multipli PriceFeedAdapter -> Multipli OSM
///     -> BASELINE:  Multipli Spotter + Vat + GemJoin5   (unchanged Multipli behaviour)
///     -> PROTECTED: Multipli Spotter + Vat + GemJoin5 + ASOSentinel (reads ASOVerifier)
/// The Multipli contracts are the verified mainnet sources in src/multipli, compiled with the
/// original settings and deployed from their artifacts. Shared by tests and scripts.
abstract contract SystemDeployer is CommonBase {
    bytes32 internal constant ILK = "PAXG-A";
    bytes32 internal constant PROFILE_ID = keccak256("PAXG/USD");
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;
    uint256 internal constant RAD = 1e45;

    struct Config {
        int256 initialAnswer; // 8-decimal Chainlink-style answer
        uint16 osmHop; // OSM delay [s]
        uint256 mat; // liquidation ratio [ray]
        uint256 globalLine; // Vat Line [rad]
        uint256 maxLine; // ilk ceiling: baseline line and Sentinel cap [rad]
        uint256 dust; // minimum vault debt [rad]
        uint256 gap; // Sentinel headroom per healthy poke [rad]
        uint16 maxPriceGapBps; // Sentinel: tolerated Vat price above attested price
        uint256 quorum; // ASO N
        uint64 maxAge; // ASO freshness [s]
        uint64 maxValidity; // ASO max signed validity window [s]
        uint16 maxDeviationBps; // ASO max cross-source spread
    }

    struct Stack {
        IVat vat;
        ISpotter spotter;
        IGemJoin join;
    }

    struct System {
        MockRWA gem;
        MockAggregator feed;
        IPriceFeedAdapter adapter;
        IOSM osm;
        Stack baseline;
        Stack protectedStack;
        ASOVerifier verifier;
        ASOSentinel sentinel;
    }

    /// @dev mat (140%), OSM hop (3600s), ilk line (1,000,000 rwaUSD) and dust (100 rwaUSD) match Multipli's
    /// live PAXG ("paxg") configuration read from Ethereum mainnet at block 26,009,365 (2026-09-19); the
    /// adapter's 24h maxDelay is its constructor default, also confirmed on-chain. The price, global Line
    /// and every ASO/Sentinel parameter are prototype choices, not Multipli values.
    function defaultConfig() internal pure returns (Config memory c) {
        c.initialAnswer = 2_500e8; // $2,500
        c.osmHop = 3600;
        c.mat = 1.4e27;
        c.globalLine = 10_000_000 * RAD;
        c.maxLine = 1_000_000 * RAD;
        c.dust = 100 * RAD;
        c.gap = 200_000 * RAD;
        c.maxPriceGapBps = 200; // 2%
        c.quorum = 3; // 3-of-5
        c.maxAge = 1 hours;
        c.maxValidity = 2 hours;
        c.maxDeviationBps = 100; // 1%
    }

    function _deploySystem(Config memory c, address admin, address feeder, address guardian, address[] memory signers)
        internal
        returns (System memory s)
    {
        s.gem = new MockRWA(admin);
        s.feed = new MockAggregator(8, feeder, c.initialAnswer);
        s.adapter = IPriceFeedAdapter(
            vm.deployCode("adapter.sol:PriceFeedAdapter", abi.encode(address(s.gem), address(s.feed)))
        );
        s.osm = IOSM(vm.deployCode("osm.sol:OSM", abi.encode(address(s.adapter))));
        s.osm.step(c.osmHop);

        s.baseline = _deployStack(s, c, c.maxLine);
        s.protectedStack = _deployStack(s, c, 0); // fail closed until the Sentinel opens it

        s.verifier =
            new ASOVerifier(PROFILE_ID, admin, guardian, signers, c.quorum, c.maxAge, c.maxValidity, c.maxDeviationBps);
        s.sentinel = new ASOSentinel(
            s.protectedStack.vat,
            s.protectedStack.spotter,
            s.adapter,
            s.verifier,
            ILK,
            admin,
            c.maxLine,
            c.gap,
            c.maxPriceGapBps
        );
        // The Sentinel's ONLY privilege: it is a ward of the protected Vat (it only ever calls file "line").
        s.protectedStack.vat.rely(address(s.sentinel));
    }

    function _deployStack(System memory s, Config memory c, uint256 line) private returns (Stack memory st) {
        st.vat = IVat(vm.deployCode("vat.sol:Vat"));
        st.spotter = ISpotter(vm.deployCode("spot.sol:Spotter", abi.encode(address(st.vat))));
        st.join = IGemJoin(vm.deployCode("join.sol:GemJoin5", abi.encode(address(st.vat), ILK, address(s.gem))));
        st.vat.rely(address(st.spotter));
        st.vat.rely(address(st.join));
        st.vat.init(ILK);
        st.vat.file("Line", c.globalLine);
        st.vat.file(ILK, "line", line);
        st.vat.file(ILK, "dust", c.dust);
        st.spotter.file(ILK, "pip", address(s.osm));
        st.spotter.file(ILK, "mat", c.mat);
        s.osm.kiss(address(st.spotter));
    }
}
