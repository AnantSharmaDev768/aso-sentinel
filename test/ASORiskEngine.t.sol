// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {OriginTestBase} from "./utils/OriginTestBase.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";
import {ASORiskEngine} from "../src/risk/ASORiskEngine.sol";
import {CostModel} from "../src/risk/CostModel.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ASORiskEngineTest is OriginTestBase {
    ASORiskEngine internal re;

    function setUp() public override {
        super.setUp();
        re = o.riskEngine;
    }

    function _round5(uint256[5] memory usd)
        internal
        view
        returns (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs)
    {
        uint256[] memory p = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            p[i] = usd[i] * 1e18;
        }
        return _round(p, nextNonce);
    }

    // ================================================================ history

    function test_SyncRecordsEachAcceptedRoundOnce() public {
        assertFalse(re.sync(), "nothing accepted yet");
        _submitAgreeing(2_500); // _submit syncs
        assertEq(re.storedObservations(), 1);
        assertFalse(re.sync(), "same round is not recorded twice");
        ASORiskEngine.Observation memory ob = re.observation(0);
        assertEq(ob.price, 2_500e18);
        assertEq(ob.nonce, 1);
        assertEq(ob.timestamp, block.timestamp);
    }

    function test_DisputedRoundIsNotRecorded() public {
        _submitAgreeing(2_500);
        _submit(_p(2_000e18, 2_500e18, 2_500e18)); // disputed; accepted nonce unchanged
        assertEq(re.storedObservations(), 1);
    }

    function test_RingBufferKeepsNewest32() public {
        for (uint256 i; i < 33; ++i) {
            _submitAgreeing(2_500 + i);
            vm.warp(block.timestamp + 60);
        }
        assertEq(re.observationCount(), 33);
        assertEq(re.storedObservations(), 32);
        assertEq(re.observation(0).nonce, 33, "newest");
        assertEq(re.observation(31).nonce, 2, "oldest kept");
        vm.expectRevert(ASORiskEngine.InvalidParams.selector);
        re.observation(32);
    }

    // ================================================================ TWAP

    function test_TwapIsExactTimeWeightedAverage() public {
        _submitAgreeing(2_500); // holds for 3 h
        vm.warp(block.timestamp + 3 hours);
        _submitAgreeing(3_000); // holds for 3 h
        vm.warp(block.timestamp + 3 hours);
        (uint256 t, bool ok, uint256 cov) = re.twap();
        assertEq(t, 2_750e18, "(2500*3h + 3000*3h) / 6h");
        assertTrue(ok);
        assertEq(cov, 10_000);
    }

    function test_TwapOnlyUsesTheWindow() public {
        _submitAgreeing(1_000);
        vm.warp(block.timestamp + 10 hours);
        _submitAgreeing(1_020); // within 1% of nothing: a fresh agreeing round
        vm.warp(block.timestamp + 2 hours);
        // window = last 6 h: 4 h at 1,000 + 2 h at 1,020
        (uint256 t,,) = re.twap();
        assertEq(t, uint256(1_000e18 * 4 + 1_020e18 * 2) / 6);
    }

    function test_TwapInsufficientCoverage() public {
        _submitAgreeing(2_500);
        vm.warp(block.timestamp + 2 hours); // 2 h of 6 h = 33% < 50%
        (uint256 t, bool ok, uint256 cov) = re.twap();
        assertEq(t, 2_500e18);
        assertFalse(ok);
        assertEq(cov, 3_333);
    }

    function test_TwapWithNoHistory() public view {
        (uint256 t, bool ok, uint256 cov) = re.twap();
        assertEq(t, 0);
        assertFalse(ok);
        assertEq(cov, 0);
    }

    // ================================================================ velocity

    function test_VelocityPerHour() public {
        _submitAgreeing(2_500);
        vm.warp(block.timestamp + 30 minutes);
        _submitAgreeing(2_600);
        (uint256 v, bool rising, bool ok) = re.velocity();
        assertEq(v, 800, "+4% in 30 min = 8% per hour");
        assertTrue(rising);
        assertTrue(ok);
    }

    function test_VelocityFloorsTinyIntervals_AndFalling() public {
        _submitAgreeing(2_525);
        _submitAgreeing(2_500); // same block: dt = 0 -> floored to 60 s
        (uint256 v, bool rising, bool ok) = re.velocity();
        assertEq(v, uint256(25e18 * 10_000 * 3600) / (2_525e18 * 60), "falling ~1% in the 60 s floor");
        assertFalse(rising);
        assertTrue(ok);
    }

    function test_VelocityNeedsTwoObservations() public {
        _submitAgreeing(2_500);
        (,, bool ok) = re.velocity();
        assertFalse(ok);
    }

    // ================================================================ deviation / effective price

    function test_SpotDeviationAndEffectivePrice() public {
        _submitAgreeing(2_500);
        vm.warp(block.timestamp + 3 hours);
        _submitAgreeing(3_000);
        vm.warp(block.timestamp + 3 hours);
        _submitAgreeing(3_000); // spot 3,000; TWAP still 2,750 (the new point has 0 s of weight)
        (uint256 dev, bool above, bool ok) = re.spotDeviation();
        assertEq(dev, 909, "250 / 2750");
        assertTrue(above);
        assertTrue(ok);
        (uint256 eff, bool twapOk) = re.effectivePrice();
        assertEq(eff, 2_750e18, "min(spot, TWAP)");
        assertTrue(twapOk);
    }

    function test_EffectivePriceIsSpotWhenBelowTwap() public {
        _submitAgreeing(3_000);
        vm.warp(block.timestamp + 6 hours);
        _submitAgreeing(2_500);
        (uint256 eff,) = re.effectivePrice();
        assertEq(eff, 2_500e18);
    }

    function test_EffectivePriceWithoutValidTwapIsSpotAndFlagged() public {
        _submitAgreeing(2_500);
        (uint256 eff, bool twapOk) = re.effectivePrice();
        assertEq(eff, 2_500e18, "no fabricated fallback");
        assertFalse(twapOk);
    }

    // ================================================================ per-source record / weighted median

    function test_RecordSourcesComputesWeightedMedian() public {
        // weights by ascending source: 3000, 2500, 2000, 1500, 1000 (total 10,000)
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) =
            _round5([uint256(2_485), 2_490, 2_500, 2_505, 2_509]); // spread 0.96% < 1%: accepted
        assertEq(uint8(o.verifier.submitRound(atts, sigs)), uint8(ASOVerifier.Status.OK));
        nextNonce++;
        re.recordSources(atts, sigs);
        // cumulative: 2485:3000, 2490:5500 >= 5000 -> weighted median 2,490 (plain median is 2,500)
        assertEq(re.weightedMedianPrice(), 2_490e18);
        assertEq(re.weightedNonce(), 1);
        assertEq(re.weightedSourceCount(), 5);
        (uint128 price, uint64 va, uint64 n) = re.lastReport(signerAddrs[4]);
        assertEq(price, 2_509e18);
        assertEq(va, block.timestamp);
        assertEq(n, 1);
    }

    function test_RecordSources_RejectsBadInput() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) =
            _round5([uint256(2_500), 2_500, 2_500, 2_500, 2_500]);
        o.verifier.submitRound(atts, sigs);
        nextNonce++;

        // tampered price
        ASOVerifier.PriceAttestation[] memory bad = atts;
        uint256 saved = bad[1].price;
        bad[1].price = 9_999e18;
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.InvalidSignature.selector, 1));
        re.recordSources(bad, sigs);
        bad[1].price = saved;

        // below quorum
        ASOVerifier.PriceAttestation[] memory two = new ASOVerifier.PriceAttestation[](2);
        bytes[] memory twoSigs = new bytes[](2);
        (two[0], two[1], twoSigs[0], twoSigs[1]) = (atts[0], atts[1], sigs[0], sigs[1]);
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.BelowQuorum.selector, 2, 3));
        re.recordSources(two, twoSigs);

        // duplicate source
        ASOVerifier.PriceAttestation[] memory dup = new ASOVerifier.PriceAttestation[](3);
        bytes[] memory dupSigs = new bytes[](3);
        (dup[0], dup[1], dup[2]) = (atts[0], atts[1], atts[1]);
        (dupSigs[0], dupSigs[1], dupSigs[2]) = (sigs[0], sigs[1], sigs[1]);
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.SignersNotStrictlyAscending.selector, 2));
        re.recordSources(dup, dupSigs);

        // valid, then a second record of the same round is refused
        re.recordSources(atts, sigs);
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.AlreadyRecorded.selector, 1));
        re.recordSources(atts, sigs);
    }

    function test_RecordSources_OnlyLatestAcceptedRound() public {
        (ASOVerifier.PriceAttestation[] memory old, bytes[] memory oldSigs) =
            _round5([uint256(2_500), 2_500, 2_500, 2_500, 2_500]);
        o.verifier.submitRound(old, oldSigs);
        nextNonce++;
        vm.warp(block.timestamp + 1);
        _submitAgreeing(2_500); // nonce 2 accepted
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.NotLatestAcceptedRound.selector, 1, 2));
        re.recordSources(old, oldSigs);
    }

    function test_RecordSources_UnauthorisedSource() public {
        // deterministic outsider whose address sorts after all five sources
        address outsider;
        uint256 key;
        for (uint256 i; outsider <= signerAddrs[4]; ++i) {
            (outsider, key) = makeAddrAndKey(string.concat("outsider", vm.toString(i)));
        }
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) =
            _round5([uint256(2_500), 2_500, 2_500, 2_500, 2_500]);
        o.verifier.submitRound(atts, sigs);
        nextNonce++;
        uint256 idx = 4; // replace the last source, keeping the ascending order
        atts[idx].source = outsider;
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(key, o.verifier.attestationDigest(atts[idx]));
        sigs[idx] = abi.encodePacked(r, s_, v);
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.NotAnAuthorisedSource.selector, outsider));
        re.recordSources(atts, sigs);
    }

    function test_RecordSources_NoAcceptedRound() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) =
            _round5([uint256(2_500), 2_500, 2_500, 2_500, 2_500]);
        vm.expectRevert(ASORiskEngine.NoAcceptedRound.selector);
        re.recordSources(atts, sigs);
    }

    function test_RecordSources_MissingWeight() public {
        ASORiskEngine fresh = new ASORiskEngine(o.verifier, admin, 6 hours, 5_000, 60, 7 days);
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) =
            _round5([uint256(2_500), 2_500, 2_500, 2_500, 2_500]);
        o.verifier.submitRound(atts, sigs);
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.MissingWeight.selector, signerAddrs[0]));
        fresh.recordSources(atts, sigs);
    }

    // ================================================================ cost gate / depth

    function test_DepthGoesStaleAfterMaxAge() public {
        assertTrue(re.depthFresh());
        vm.warp(block.timestamp + 7 days + 1);
        assertFalse(re.depthFresh());
        (CostModel.Concern c,) = re.costAssessment(100_000e18, 1.4e27);
        assertEq(uint8(c), uint8(CostModel.Concern.INSUFFICIENT_DATA));
    }

    function test_QuoteMatchesLibrary() public view {
        (CostModel.Quote memory q, CostModel.Concern c,) = re.quote(1_000e18, 100_000e18, 1.4e27, 10_000);
        assertEq(q.costUsd, 50_000e18);
        assertEq(q.extractableUsd, 30_000e18);
        assertEq(uint8(c), uint8(CostModel.Concern.ELEVATED));
    }

    // ================================================================ admin

    function test_AdminIsOwnerOnlyAndBounded() public {
        vm.startPrank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        re.setMarketDepth(1e18);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        re.setSourceWeight(signerAddrs[0], 1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        re.setTwapParams(6 hours, 5_000, 60);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        re.setCostParams(5_000, 30_000, 10_000, 7 days);
        vm.stopPrank();

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.NotAnAuthorisedSource.selector, mallory));
        re.setSourceWeight(mallory, 100);
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.InvalidWeight.selector, 0));
        re.setSourceWeight(signerAddrs[0], 0);
        vm.expectRevert(abi.encodeWithSelector(ASORiskEngine.InvalidWeight.selector, 10_001));
        re.setSourceWeight(signerAddrs[0], 10_001);
        vm.expectRevert(ASORiskEngine.InvalidParams.selector);
        re.setMarketDepth(0);
        vm.expectRevert(ASORiskEngine.InvalidParams.selector);
        re.setTwapParams(1 minutes, 5_000, 60);
        vm.expectRevert(ASORiskEngine.InvalidParams.selector);
        re.setCostParams(5_000, 5_000, 10_000, 7 days); // elevated < high
        re.setSourceWeight(signerAddrs[0], 1);
        assertEq(re.sourceWeight(signerAddrs[0]), 1);
        vm.stopPrank();
    }
}
