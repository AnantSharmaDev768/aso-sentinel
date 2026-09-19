// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {OriginTestBase} from "./utils/OriginTestBase.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";
import {OriginSentinel} from "../src/OriginSentinel.sol";

/// @notice Baseline (Multipli contracts alone) vs protected (same contracts + OriginSentinel), fed by the
/// same price path. Scenarios A–E of the Manipulation Cost Lab, as deterministic tests.
contract OriginScenariosTest is OriginTestBase {
    OriginSentinel internal sen;

    function setUp() public override {
        super.setUp();
        sen = o.sentinel;
        _warmup(2_500);
        _deposit(o.baseline, alice, 100e18);
        _deposit(o.protectedStack, alice, 100e18);
        _borrow(o.baseline, alice, 50_000e18);
        _borrow(o.protectedStack, alice, 50_000e18);
    }

    function _hourlyRound(uint256 usd) internal {
        vm.warp(block.timestamp + 1 hours);
        _setMarketPrice(usd);
        o.osm.poke();
        _pokeSpotters();
        _submitAgreeing(usd);
    }

    /// Bad debt [wad] of an urn if the collateral is valued at `usd`.
    function _badDebt(Stack memory st, address who, uint256 usd) internal view returns (uint256) {
        (uint256 ink, uint256 art) = st.vat.urns(ILK, who);
        uint256 value = ink * usd;
        return art > value ? art - value : 0;
    }

    // ------------------------------------------------------------------ A. thin-market pump

    /// All five sources HONESTLY report a manipulated market (+60%): the quorum is satisfied and the
    /// verifier says OK. The baseline lends against the pumped price; the protected market does not.
    function test_A_ThinMarketPump_BaselineBadDebt_ProtectedBlocks() public {
        vm.prank(admin);
        o.riskEngine.setMarketDepth(1_000e18); // thin-market ASSUMPTION: $1k moves the price 1%
        _hourlyRound(4_000); // pump starts; feed and every source read 4,000
        assertEq(uint8(o.verifier.status()), uint8(ASOVerifier.Status.OK), "quorum is happy");
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);

        _hourlyRound(4_000); // OSM hop 1: nxt = 4,000
        _hourlyRound(4_000); // OSM hop 2: both Vats now lend at 4,000
        assertEq(sen.vatPrice(), 4_000e18);
        _poke();
        _assertState(_state(), OriginSentinel.State.PROTECTIVE);

        _deposit(o.baseline, mallory, 100e18);
        _deposit(o.protectedStack, mallory, 100e18);
        _borrow(o.baseline, mallory, 285_000e18); // 100 * 4,000 / 1.4 = 285,714
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, mallory, 1e18);

        // The market returns to its fair value: the baseline is left with bad debt.
        assertEq(_badDebt(o.baseline, mallory, 2_500), 35_000e18, "285k debt vs 250k collateral");
        assertEq(_art(o.protectedStack, mallory), 0);
    }

    // ------------------------------------------------------------------ B. sustained squeeze

    /// A manipulation sustained longer than the TWAP window eventually becomes the TWAP. The Sentinel
    /// delays but cannot tell it apart forever; what it guarantees is the BOUND: exposure per epoch is
    /// capped. This test documents that limit honestly.
    function test_B_SustainedSqueeze_TwapCatchesUp_ExposureBoundedPerEpoch() public {
        vm.prank(admin);
        o.riskEngine.setMarketDepth(1_000e18);
        _hourlyRound(4_000);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        for (uint256 i; i < 7; ++i) {
            _hourlyRound(4_000);
            _poke();
        }
        // 8 h at 4,000 > 6 h window: TWAP == 4,000, velocity 0. Recovery gate then reopens, in WATCH
        // (thin-market cost concern), never FRESH, and only with a bounded headroom.
        (uint256 twap,,) = o.riskEngine.twap();
        assertEq(twap, 4_000e18);
        _hourlyRound(4_000);
        OriginSentinel.State s = _poke();
        assertTrue(s == OriginSentinel.State.WATCH || s == OriginSentinel.State.RECOVERING, "not FRESH");
        _hourlyRound(4_000);
        _assertState(_poke(), OriginSentinel.State.WATCH);

        uint256 debt = sen.ilkDebt();
        uint256 line = _line(o.protectedStack);
        assertLe(line - debt, oc.base.gap * oc.watchGapBps / 10_000, "WATCH headroom only");
        assertLe(line, sen.epochStartDebt() + oc.epoch.growthCap, "epoch cap");

        // Worst case: the attacker takes the whole bounded headroom at the manipulated price.
        _deposit(o.protectedStack, mallory, 100e18);
        _borrow(o.protectedStack, mallory, (line - debt) / RAY);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, mallory, 1e18);
        // Baseline for the same attacker: limited only by collateral and its 1M line.
        _deposit(o.baseline, mallory, 100e18);
        _borrow(o.baseline, mallory, 285_000e18);
        assertGt(_art(o.baseline, mallory), 5 * _art(o.protectedStack, mallory));
    }

    // ------------------------------------------------------------------ C. honest gradual movement

    /// +0.5% per hour for 8 hours with the feed following: not treated as manipulation.
    function test_C_HonestGradualMovement_StaysFresh() public {
        uint256 price = 2_500;
        for (uint256 i; i < 8; ++i) {
            price = price * 1_005 / 1_000;
            _hourlyRound(price);
            _assertState(_poke(), OriginSentinel.State.FRESH);
        }
        _borrow(o.protectedStack, alice, 10_000e18);
    }

    // ------------------------------------------------------------------ D. stale oracle

    /// The market falls 40% but the Chainlink-style feed freezes; the OSM keeps the old price.
    function test_D_StaleOracle_BaselineOverLends_ProtectedBlocks() public {
        vm.warp(block.timestamp + 10 minutes);
        _submitAgreeing(1_500); // sources see the real price; feed/OSM stay at 2,500
        uint32 f;
        (, f) = sen.assess();
        assertTrue(f & sen.F_VAT_ABOVE_EFFECTIVE() != 0);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        _deposit(o.baseline, mallory, 100e18);
        _deposit(o.protectedStack, mallory, 100e18);
        _borrow(o.baseline, mallory, 178_000e18);
        assertEq(_badDebt(o.baseline, mallory, 1_500), 28_000e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, mallory, 1e18);
    }

    // ------------------------------------------------------------------ E. conflicting sources

    function test_E_ConflictingSources_Disputed_RepayWorks_RecoveryNeedsNewRound() public {
        _submit(_p(1_500e18, 2_500e18, 2_510e18));
        _assertState(_poke(), OriginSentinel.State.DISPUTED);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, alice, 1e18);
        _repay(o.protectedStack, alice, 10_000e18);
        vm.warp(block.timestamp + 1);
        _submitAgreeing(2_500);
        _assertState(_poke(), OriginSentinel.State.RECOVERING);
        vm.warp(block.timestamp + oc.thresholds.recoveryDelay);
        _setMarketPrice(2_500);
        _submitAgreeing(2_500);
        _assertState(_poke(), OriginSentinel.State.FRESH);
        _borrow(o.protectedStack, alice, 10_000e18);
    }
}
