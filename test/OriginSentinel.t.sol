// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {OriginTestBase} from "./utils/OriginTestBase.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";
import {OriginSentinel} from "../src/OriginSentinel.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";
import {CostModel} from "../src/risk/CostModel.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract OriginSentinelTest is OriginTestBase {
    OriginSentinel internal sen;

    function setUp() public override {
        super.setUp();
        sen = o.sentinel;
    }

    /// @dev Keep every data source fresh at the current time: feeder update + agreeing round.
    function _freshAt(uint256 usd) internal {
        _setMarketPrice(usd);
        _submitAgreeing(usd);
    }

    function _flags() internal view returns (uint32 f) {
        (, f) = sen.assess();
    }

    // ================================================================ start and warm-up

    function test_StartsProtectiveAndClosed() public {
        _assertState(_state(), OriginSentinel.State.PROTECTIVE);
        assertEq(_line(o.protectedStack), 0);
        _deposit(o.protectedStack, alice, 100e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, alice, 1_000e18);
    }

    function test_FirstHealthyRoundWithoutHistoryOnlyReachesRecovering() public {
        _submitAgreeing(2_500);
        _assertState(_poke(), OriginSentinel.State.RECOVERING);
        assertTrue(_hasFlag(sen.lastFlags(), sen.F_TWAP_INSUFFICIENT()), "no TWAP history yet");
        assertEq(_line(o.protectedStack), 0);
    }

    function test_WarmupReachesFresh_EpochCapBindsHeadroom() public {
        _warmup(2_500);
        assertEq(_line(o.protectedStack), oc.epoch.growthCap, "min(debt 0 + gap 200k, cap 100k)");
        _deposit(o.protectedStack, alice, 100e18);
        _borrow(o.protectedStack, alice, 100_000e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, alice, 1e18);
    }

    // ================================================================ WATCH

    function test_ModerateTwapDeviationIsWatch_WithReducedHeadroom() public {
        _warmup(2_500);
        vm.warp(block.timestamp + 1 hours);
        _freshAt(2_600); // +4% vs a TWAP near 2,500; velocity 4%/h
        (OriginSentinel.State target, uint32 f) = sen.assess();
        _assertState(target, OriginSentinel.State.WATCH);
        assertTrue(_hasFlag(f, sen.F_TWAP_DEVIATION_WATCH()));
        assertFalse(_hasFlag(f, sen.PROTECT_MASK()));
        _assertState(_poke(), OriginSentinel.State.WATCH);
        assertEq(_line(o.protectedStack), oc.base.gap * oc.watchGapBps / 10_000, "25% of the gap");
    }

    function test_SourceDivergenceIsWatch() public {
        _warmup(2_500);
        vm.warp(block.timestamp + 10 minutes);
        uint256[] memory p = new uint256[](5);
        (p[0], p[1], p[2], p[3], p[4]) = (2_487e18, 2_487e18, 2_500e18, 2_510e18, 2_511e18); // spread 0.96%
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(p, nextNonce++);
        o.verifier.submitRound(atts, sigs);
        o.riskEngine.recordSources(atts, sigs);
        // plain median 2,500; weighted median 2,487 (heaviest sources are lowest): 0.52% apart >= 0.5%
        assertEq(o.riskEngine.weightedMedianPrice(), 2_487e18);
        assertTrue(_hasFlag(_flags(), sen.F_SOURCE_DIVERGENCE()));
        _assertState(_poke(), OriginSentinel.State.WATCH);
    }

    // ================================================================ PROTECTIVE / DISPUTED

    function test_PumpIsProtective_RepaymentStillWorks() public {
        _warmup(2_500);
        _deposit(o.protectedStack, alice, 100e18);
        _borrow(o.protectedStack, alice, 50_000e18);
        vm.warp(block.timestamp + 1 hours);
        _freshAt(4_000); // +60%: every source honestly reads a manipulated market
        uint32 f = _flags();
        assertTrue(_hasFlag(f, sen.F_TWAP_DEVIATION_PROTECT()), "far from TWAP");
        assertTrue(_hasFlag(f, sen.F_VELOCITY_PROTECT()), "60% in an hour");
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        assertEq(_line(o.protectedStack), 0);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, alice, 1e18);
        _repay(o.protectedStack, alice, 20_000e18); // repayment is never blocked
        assertEq(_art(o.protectedStack, alice), 30_000e18);
    }

    function test_DisagreementIsDisputed() public {
        _warmup(2_500);
        _submit(_p(1_500e18, 2_500e18, 2_510e18));
        uint32 f = _flags();
        assertTrue(_hasFlag(f, sen.F_ASO_DISPUTED()));
        _assertState(_poke(), OriginSentinel.State.DISPUTED);
        assertEq(_line(o.protectedStack), 0);
    }

    function test_StaleAttestationsAreProtective() public {
        _warmup(2_500);
        vm.warp(block.timestamp + oc.base.maxAge + 1);
        assertTrue(_hasFlag(_flags(), sen.F_ASO_STALE()));
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
    }

    function test_HaltIsProtective() public {
        _warmup(2_500);
        vm.prank(admin);
        o.verifier.halt();
        assertTrue(_hasFlag(_flags(), sen.F_ASO_HALTED()));
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
    }

    function test_MultipliAdapterStaleIsProtective() public {
        _warmup(2_500);
        vm.warp(block.timestamp + 24 hours + 1); // feeder silent past the adapter's maxDelay
        _submitAgreeing(2_500); // attestations are fresh
        assertTrue(_hasFlag(_flags(), sen.F_FEED_STALE()));
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
    }

    function test_RevertingFeedFailsClosed() public {
        _warmup(2_500);
        vm.mockCallRevert(address(o.feed), abi.encodeWithSelector(MockAggregator.latestRoundData.selector), "x");
        assertTrue(_hasFlag(_flags(), sen.F_FEED_STALE()));
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
    }

    function test_VatPriceAboveEffectivePriceIsProtective() public {
        _warmup(2_500);
        vm.warp(block.timestamp + 10 minutes);
        _submitAgreeing(2_000); // market fell; the OSM still serves 2,500
        assertTrue(_hasFlag(_flags(), sen.F_VAT_ABOVE_EFFECTIVE()));
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
    }

    // ================================================================ recovery gate

    function test_RecoveryNeverJumpsToFresh_NeedsNewRoundAndDelay() public {
        _warmup(2_500);
        vm.prank(admin);
        o.verifier.halt();
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        uint64 restrictedAt = sen.restrictedAtNonce();

        vm.prank(admin);
        o.verifier.unhalt(); // old data is still fresh and healthy
        (OriginSentinel.State target,) = sen.assess();
        _assertState(target, OriginSentinel.State.FRESH);
        _assertState(_poke(), OriginSentinel.State.RECOVERING); // not FRESH
        assertEq(_line(o.protectedStack), 0);

        vm.warp(block.timestamp + oc.thresholds.recoveryDelay); // waited, but no new round
        _setMarketPrice(2_500);
        _assertState(_poke(), OriginSentinel.State.RECOVERING);
        assertEq(o.verifier.lastAcceptedNonce(), restrictedAt, "no newer accepted round yet");

        _submitAgreeing(2_500); // new round, delay satisfied
        _assertState(_poke(), OriginSentinel.State.FRESH);
        assertGt(_line(o.protectedStack), 0);
    }

    function test_RecoveryNeedsDelayEvenWithNewRound() public {
        _warmup(2_500);
        _submit(_p(1_500e18, 2_500e18, 2_510e18));
        _assertState(_poke(), OriginSentinel.State.DISPUTED);
        vm.warp(block.timestamp + 1);
        _submitAgreeing(2_500);
        _assertState(_poke(), OriginSentinel.State.RECOVERING);
        vm.warp(block.timestamp + 10 minutes);
        _submitAgreeing(2_500); // new round, but the delay has not passed
        _assertState(_poke(), OriginSentinel.State.RECOVERING);
        vm.warp(block.timestamp + oc.thresholds.recoveryDelay);
        _freshAt(2_500);
        _assertState(_poke(), OriginSentinel.State.FRESH);
    }

    function test_NewIncidentDuringRecoveryRestrictsAgain() public {
        _warmup(2_500);
        _submit(_p(1_500e18, 2_500e18, 2_510e18));
        _assertState(_poke(), OriginSentinel.State.DISPUTED);
        vm.warp(block.timestamp + 1);
        _submitAgreeing(2_500);
        _assertState(_poke(), OriginSentinel.State.RECOVERING);
        _submit(_p(1_500e18, 2_500e18, 2_510e18)); // disagreement again
        _assertState(_poke(), OriginSentinel.State.DISPUTED);
        assertEq(uint8(sen.previousState()), uint8(OriginSentinel.State.RECOVERING));
    }

    // ================================================================ epoch growth cap

    function test_EpochCap_NetGrowthCannotExceedCapWithinEpoch() public {
        _warmup(2_500);
        _deposit(o.protectedStack, alice, 200e18);
        _borrow(o.protectedStack, alice, 100_000e18);
        _repay(o.protectedStack, alice, 40_000e18);
        _poke(); // repeated pokes inside the epoch never reset the epoch baseline
        _poke();
        _borrow(o.protectedStack, alice, 40_000e18); // back to +100k net
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, alice, 1e18);
        (, uint256 startDebt,) = sen.currentEpoch();
        assertEq(startDebt, 0);
    }

    function test_EpochCap_RollsExactlyAtBoundaryAndAligns() public {
        _warmup(2_500);
        uint64 start = sen.epochStart();
        _deposit(o.protectedStack, alice, 200e18);
        _borrow(o.protectedStack, alice, 100_000e18);

        vm.warp(uint256(start) + oc.epoch.duration - 1);
        _freshAt(2_500);
        _poke();
        assertEq(sen.epochStart(), start, "not yet");
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, alice, 1e18);

        vm.warp(uint256(start) + oc.epoch.duration);
        _freshAt(2_500);
        _poke();
        assertEq(sen.epochStart(), start + oc.epoch.duration, "rolled at the boundary");
        assertEq(sen.epochStartDebt(), 100_000 * RAD);
        _borrow(o.protectedStack, alice, 100_000e18); // a new epoch allows another 100k
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, alice, 1e18);

        vm.warp(uint256(start) + oc.epoch.duration * 3 + oc.epoch.duration / 2); // 2.5 epochs later
        _freshAt(2_500);
        _poke();
        assertEq(sen.epochStart(), start + oc.epoch.duration * 3, "aligned to whole epochs, no drift");
    }

    // ================================================================ cost gate

    function test_CostGate_ThinMarketElevated_VeryThinHigh_UnknownWatch() public {
        _warmup(2_500);
        vm.prank(admin);
        o.riskEngine.setMarketDepth(1_000e18); // $1k moves the price 1% (assumption)
        assertTrue(_hasFlag(_flags(), sen.F_COST_ELEVATED()));
        _assertState(_poke(), OriginSentinel.State.WATCH);

        vm.prank(admin);
        o.riskEngine.setMarketDepth(400e18);
        assertTrue(_hasFlag(_flags(), sen.F_COST_HIGH()));
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
    }

    function test_CostGate_StaleDepthIsInsufficientData() public {
        _warmup(2_500);
        vm.warp(block.timestamp + oc.maxDepthAge + 1);
        _freshAt(2_500);
        assertTrue(_hasFlag(_flags(), sen.F_COST_NO_DATA()));
        _assertState(_poke(), OriginSentinel.State.WATCH);
    }

    function test_CostGate_UsesBoundedHeadroom() public {
        _warmup(2_500);
        OriginSentinel.Snapshot memory s = sen.snapshot();
        assertEq(s.freshHeadroom, 100_000 * RAD, "bounded by the epoch cap, not the 1M line");
        assertEq(uint8(s.concern), uint8(CostModel.Concern.LOW));
    }

    // ================================================================ never touches the price

    function test_NeverChangesSpotInAnyState() public {
        uint256 spot0 = _spot(o.protectedStack);
        _warmup(2_500);
        _submit(_p(1_500e18, 2_500e18, 2_510e18));
        _poke();
        vm.warp(block.timestamp + 1 hours);
        _freshAt(4_000);
        _poke();
        vm.warp(block.timestamp + 2 days);
        _poke();
        assertEq(_spot(o.protectedStack), spot0);
    }

    // ================================================================ snapshot / admin

    function test_SnapshotMatchesGetters() public {
        _warmup(2_500);
        OriginSentinel.Snapshot memory s = sen.snapshot();
        assertEq(uint8(s.state), uint8(OriginSentinel.State.FRESH));
        assertEq(uint8(s.previousState), uint8(OriginSentinel.State.RECOVERING));
        assertEq(s.line, _line(o.protectedStack));
        assertEq(s.attestedPrice, 2_500e18);
        assertEq(s.twap, 2_500e18);
        assertTrue(s.twapOk);
        assertEq(s.vatPrice, sen.vatPrice());
        assertEq(s.epochCapLine, oc.epoch.growthCap);
    }

    function test_PokeIsPermissionless() public {
        _submitAgreeing(2_500);
        vm.prank(mallory);
        _assertState(sen.poke(), OriginSentinel.State.RECOVERING);
    }

    function test_AdminOnlyOwnerAndBounded() public {
        OriginSentinel.Limits memory l = OriginSentinel.Limits(1_000_000 * RAD, 200_000 * RAD, 2_500, 200);
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        sen.setLimits(l);

        vm.startPrank(admin);
        l.gap = 0;
        vm.expectRevert(OriginSentinel.InvalidLimits.selector);
        sen.setLimits(l);
        OriginSentinel.Thresholds memory t = oc.thresholds;
        t.twapProtectBps = t.twapWatchBps; // protect must be stricter than watch
        vm.expectRevert(OriginSentinel.InvalidThresholds.selector);
        sen.setThresholds(t);
        vm.expectRevert(OriginSentinel.InvalidEpochConfig.selector);
        sen.setEpochConfig(OriginSentinel.EpochConfig(10 minutes, 1));
        vm.expectRevert(OriginSentinel.InvalidEpochConfig.selector);
        sen.setEpochConfig(OriginSentinel.EpochConfig(1 days, 0));
        vm.stopPrank();
    }

    function test_OnlyProtectedVatWard() public view {
        assertEq(o.protectedStack.vat.wards(address(sen)), 1);
        assertEq(o.baseline.vat.wards(address(sen)), 0);
    }
}
