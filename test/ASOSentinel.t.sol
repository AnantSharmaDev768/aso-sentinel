// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {ASOTestBase} from "./utils/ASOTestBase.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";
import {ASOSentinel} from "../src/ASOSentinel.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ASOSentinelTest is ASOTestBase {
    ASOSentinel internal sen;

    function setUp() public override {
        super.setUp();
        sen = s.sentinel;
    }

    function _poke() internal returns (ASOSentinel.Reason) {
        return sen.poke();
    }

    function _assertReason(ASOSentinel.Reason got, ASOSentinel.Reason want) internal pure {
        assertEq(uint8(got), uint8(want), "reason");
    }

    function _open() internal {
        _submitAgreeing(2_500);
        _assertReason(_poke(), ASOSentinel.Reason.HEALTHY);
    }

    // ================================================================ initial state / opening

    function test_StartsFailClosed() public {
        assertTrue(sen.restricted());
        assertEq(_line(s.protectedStack), 0);
        _deposit(s.protectedStack, alice, 100e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, alice, 1e18);
    }

    function test_PokeWithoutAnyRoundStaysClosed() public {
        _assertReason(_poke(), ASOSentinel.Reason.ASO_NO_DATA);
        assertEq(_line(s.protectedStack), 0);
    }

    function test_FirstHealthyPokeOpensGapHeadroom() public {
        _open();
        assertFalse(sen.restricted());
        assertEq(_line(s.protectedStack), cfg.gap, "line = debt(0) + gap");
    }

    function test_HeadroomTracksDebt() public {
        _open();
        _deposit(s.protectedStack, alice, 100e18);
        _borrow(s.protectedStack, alice, 150_000e18);
        _poke();
        assertEq(_line(s.protectedStack), 150_000 * RAD + cfg.gap);
    }

    function test_LineNeverExceedsMaxLine() public {
        vm.prank(admin);
        sen.setLimits(250_000 * RAD, 200_000 * RAD, 200);
        _open();
        _deposit(s.protectedStack, alice, 100e18);
        _borrow(s.protectedStack, alice, 150_000e18);
        _poke();
        assertEq(_line(s.protectedStack), 250_000 * RAD, "capped at maxLine");
    }

    function test_PokeIsPermissionless() public {
        _submitAgreeing(2_500);
        vm.prank(mallory);
        _assertReason(sen.poke(), ASOSentinel.Reason.HEALTHY);
        assertEq(_line(s.protectedStack), cfg.gap);
    }

    // ================================================================ every restriction reason closes the ceiling

    function test_Restricts_WhenAsoStale() public {
        _open();
        vm.warp(block.timestamp + cfg.maxAge + 1);
        _assertReason(_poke(), ASOSentinel.Reason.ASO_STALE);
        assertEq(_line(s.protectedStack), 0);
        assertTrue(sen.restricted());
    }

    function test_Restricts_WhenAsoDisputed() public {
        _open();
        _submit(_p(2_000e18, 2_500e18, 2_500e18));
        _assertReason(_poke(), ASOSentinel.Reason.ASO_DISPUTED);
        assertEq(_line(s.protectedStack), 0);
    }

    function test_Restricts_WhenAsoHalted() public {
        _open();
        vm.prank(guardian);
        s.verifier.halt();
        _assertReason(_poke(), ASOSentinel.Reason.ASO_HALTED);
        assertEq(_line(s.protectedStack), 0);
    }

    function test_Restricts_WhenMultipliAdapterReportsStaleFeed() public {
        _open();
        // Chainlink-style feeder silent > 24h (the adapter's maxDelay); ASO sources keep attesting.
        vm.warp(block.timestamp + 24 hours + 1);
        _submitAgreeing(2_500);
        (, bool has) = s.adapter.peek();
        assertFalse(has, "adapter itself says stale");
        (, bool osmHas) = _osmPrice();
        assertTrue(osmHas, "...but the OSM still serves its cached price as valid");
        _assertReason(_poke(), ASOSentinel.Reason.FEED_STALE);
        assertEq(_line(s.protectedStack), 0);
    }

    function test_Restricts_WhenFeedReverts_FailClosed() public {
        _open();
        vm.mockCallRevert(address(s.feed), abi.encodeWithSelector(MockAggregator.latestRoundData.selector), "boom");
        _assertReason(_poke(), ASOSentinel.Reason.FEED_STALE);
        assertEq(_line(s.protectedStack), 0);
    }

    function test_Restricts_WhenVatPriceAboveFreshAttestedPrice() public {
        _open();
        _submitAgreeing(2_000); // fresh sources agree the asset fell 20%; Vat still lends at 2,500
        _assertReason(_poke(), ASOSentinel.Reason.VAT_PRICE_ABOVE_ATTESTED);
        assertEq(_line(s.protectedStack), 0);
    }

    function test_PriceGapToleranceBoundary() public {
        _open();
        _submitAgreeing(2_452); // 2,452 * 1.02 = 2,501.04 >= 2,500  -> tolerated
        _assertReason(_poke(), ASOSentinel.Reason.HEALTHY);
        vm.warp(block.timestamp + 1);
        _submitAgreeing(2_450); // 2,450 * 1.02 = 2,499.00 <  2,500  -> restrict
        _assertReason(_poke(), ASOSentinel.Reason.VAT_PRICE_ABOVE_ATTESTED);
    }

    function test_VatPriceBelowAttestedIsConservativeAndAllowed() public {
        _submitAgreeing(2_700); // Vat lends at 2,500 < attested 2,700: safe for the protocol
        _assertReason(_poke(), ASOSentinel.Reason.HEALTHY);
    }

    function test_VatPriceInvertsSpotterExactly() public view {
        assertApproxEqAbs(sen.vatPrice(), 2_500e18, 1);
        assertGe(sen.vatPrice(), 2_500e18, "rounded up, towards restricting");
    }

    // ================================================================ recovery gate

    function test_RecoveryRequiresNewAcceptedRound() public {
        _open(); // accepted nonce 1
        vm.prank(guardian);
        s.verifier.halt();
        _assertReason(_poke(), ASOSentinel.Reason.ASO_HALTED);
        assertEq(sen.restrictedAtNonce(), 1);

        vm.prank(admin);
        s.verifier.unhalt(); // old data is still fresh...
        assertEq(uint8(sen.evaluate()), uint8(ASOSentinel.Reason.HEALTHY));
        _assertReason(_poke(), ASOSentinel.Reason.AWAITING_FRESH_ROUND); // ...but not new
        assertEq(_line(s.protectedStack), 0);
        assertTrue(sen.restricted());

        vm.warp(block.timestamp + 1);
        _submitAgreeing(2_500); // nonce 2 > 1
        _assertReason(_poke(), ASOSentinel.Reason.HEALTHY);
        assertFalse(sen.restricted());
        assertEq(_line(s.protectedStack), cfg.gap);
    }

    function test_RecoveryAfterDisputeNeedsRoundNewerThanTheDispute() public {
        _open(); // accepted 1
        _submit(_p(2_000e18, 2_500e18, 2_500e18)); // disputed 2
        _poke();
        assertEq(sen.restrictedAtNonce(), 2);
        vm.warp(block.timestamp + 1);
        _submitAgreeing(2_500); // accepted 3
        _assertReason(_poke(), ASOSentinel.Reason.HEALTHY);
    }

    // ================================================================ never touches the price

    function test_SentinelNeverChangesSpot() public {
        uint256 spot0 = _spot(s.protectedStack);
        _open();
        assertEq(_spot(s.protectedStack), spot0);
        _submitAgreeing(1_000);
        _poke();
        assertEq(_spot(s.protectedStack), spot0);
        vm.warp(block.timestamp + 2 days);
        _poke();
        assertEq(_spot(s.protectedStack), spot0);
    }

    // ================================================================ admin

    function test_OnlyOwnerSetsLimits() public {
        vm.prank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        sen.setLimits(1, 1, 1);
    }

    function test_LimitBounds() public {
        vm.startPrank(admin);
        vm.expectRevert(ASOSentinel.InvalidLimits.selector);
        sen.setLimits(100, 0, 200); // zero gap
        vm.expectRevert(ASOSentinel.InvalidLimits.selector);
        sen.setLimits(100, 101, 200); // gap > maxLine
        vm.expectRevert(ASOSentinel.InvalidLimits.selector);
        sen.setLimits(100, 100, 5_001);
        vm.stopPrank();
    }

    function test_SentinelIsOnlyWardItNeeds() public view {
        assertEq(s.protectedStack.vat.wards(address(sen)), 1);
        assertEq(s.baseline.vat.wards(address(sen)), 0, "no access to the baseline");
    }
}
