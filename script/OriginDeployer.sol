// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {SystemDeployer} from "./SystemDeployer.sol";
import {IVat, ISpotter, IOSM, IPriceFeedAdapter, IGemJoin} from "../src/interfaces/IMultipli.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";
import {ASORiskEngine} from "../src/risk/ASORiskEngine.sol";
import {OriginSentinel} from "../src/OriginSentinel.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";
import {MockRWA} from "../src/mocks/MockRWA.sol";

/// @notice Deploys the unified Origin // ASO Sentinel system, fed by ONE price path:
///   feed (mock Chainlink) -> Multipli PriceFeedAdapter -> Multipli OSM
///     -> BASELINE:  Multipli Spotter + Vat + GemJoin5 (no protection)
///     -> PROTECTED: Multipli Spotter + Vat + GemJoin5, ward = OriginSentinel
///   ASOVerifier (signed rounds) -> ASORiskEngine (history, TWAP, velocity, cost gate) -> OriginSentinel
/// Multipli settings (mat, OSM hop, line, dust) come from SystemDeployer.defaultConfig(), which mirrors
/// mainnet. The Origin parameters below are prototype choices, documented in docs/ORIGIN.md.
abstract contract OriginDeployer is SystemDeployer {
    struct OriginConfig {
        Config base;
        uint32 twapWindow;
        uint16 minCoverageBps;
        uint32 minVelocityInterval;
        uint32 maxDepthAge;
        uint256 depthUsdPer1Pct; // [wad] governance ASSUMPTION, not measured liquidity
        uint16[5] sourceWeights; // by ascending source address (configured reliability/liquidity weights)
        uint16 watchGapBps;
        OriginSentinel.Thresholds thresholds;
        OriginSentinel.EpochConfig epoch;
    }

    struct OriginSystem {
        MockRWA gem;
        MockAggregator feed;
        IPriceFeedAdapter adapter;
        IOSM osm;
        Stack baseline;
        Stack protectedStack;
        ASOVerifier verifier;
        ASORiskEngine riskEngine;
        OriginSentinel sentinel;
    }

    function defaultOriginConfig() internal pure returns (OriginConfig memory c) {
        c.base = defaultConfig();
        c.twapWindow = 6 hours;
        c.minCoverageBps = 5_000; // TWAP valid once history covers half the window
        c.minVelocityInterval = 60;
        c.maxDepthAge = 7 days;
        c.depthUsdPer1Pct = 250_000e18; // deep market assumption for the healthy baseline scenario
        c.sourceWeights = [uint16(3_000), 2_500, 2_000, 1_500, 1_000];
        c.watchGapBps = 2_500; // WATCH opens 25% of the normal headroom
        c.thresholds = OriginSentinel.Thresholds({
            twapWatchBps: 300, // 3% away from TWAP
            twapProtectBps: 1_500, // 15% away from TWAP
            velocityWatchBpsPerHour: 500, // 5% per hour
            velocityProtectBpsPerHour: 2_000, // 20% per hour
            sourceDivergenceBps: 50, // weighted median vs plain median, 0.5%
            recoveryDelay: 1 hours
        });
        c.epoch = OriginSentinel.EpochConfig({duration: 1 days, growthCap: 100_000 * RAD});
    }

    function _deployOrigin(OriginConfig memory c, address admin, address feeder, address[] memory signers)
        internal
        returns (OriginSystem memory s)
    {
        s.gem = new MockRWA(admin);
        s.feed = new MockAggregator(8, feeder, c.base.initialAnswer);
        s.adapter = IPriceFeedAdapter(
            vm.deployCode("adapter.sol:PriceFeedAdapter", abi.encode(address(s.gem), address(s.feed)))
        );
        s.osm = IOSM(vm.deployCode("osm.sol:OSM", abi.encode(address(s.adapter))));
        s.osm.step(c.base.osmHop);

        s.baseline = _deployOriginStack(s, c.base, c.base.maxLine);
        s.protectedStack = _deployOriginStack(s, c.base, 0); // fail closed

        s.verifier = new ASOVerifier(
            PROFILE_ID, admin, admin, signers, c.base.quorum, c.base.maxAge, c.base.maxValidity, c.base.maxDeviationBps
        );
        s.riskEngine =
            new ASORiskEngine(s.verifier, admin, c.twapWindow, c.minCoverageBps, c.minVelocityInterval, c.maxDepthAge);
        s.sentinel = new OriginSentinel(
            OriginSentinel.Deps({
                vat: s.protectedStack.vat,
                spotter: s.protectedStack.spotter,
                feed: s.adapter,
                verifier: s.verifier,
                riskEngine: s.riskEngine,
                ilk: ILK
            }),
            admin,
            OriginSentinel.Limits({
                maxLine: c.base.maxLine,
                gap: c.base.gap,
                watchGapBps: c.watchGapBps,
                maxPriceGapBps: c.base.maxPriceGapBps
            }),
            c.thresholds,
            c.epoch
        );
        // The Sentinel's ONLY privilege: ward of the protected Vat (it only ever calls file "line").
        s.protectedStack.vat.rely(address(s.sentinel));
    }

    /// @dev Owner-only configuration of the risk engine; call from the admin (broadcast or prank).
    function _configureRisk(OriginSystem memory s, OriginConfig memory c, address[] memory sortedSigners) internal {
        s.riskEngine.setMarketDepth(c.depthUsdPer1Pct);
        for (uint256 i; i < sortedSigners.length; ++i) {
            s.riskEngine.setSourceWeight(sortedSigners[i], c.sourceWeights[i]);
        }
    }

    function _deployOriginStack(OriginSystem memory s, Config memory c, uint256 line)
        private
        returns (Stack memory st)
    {
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
