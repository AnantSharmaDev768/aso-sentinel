// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {OriginTestBase} from "../utils/OriginTestBase.sol";
import {OriginSentinel} from "../../src/OriginSentinel.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {console2} from "forge-std/console2.sol";

/// @notice Random sequences of rounds (agreeing, drifting, pumping, disagreeing), time jumps, feeder
/// updates, OSM hops, depth changes, pokes, borrows and repays against the protected Vat.
contract OriginHandler is CommonBase, StdUtils {
    OriginInvariantsTest internal t;
    OriginSentinel internal sen;
    bytes32 internal constant ILK = "PAXG-A";

    uint256 public ghostBorrowsWhileRestricted;
    uint256 public ghostFailedRepays;
    uint256 public ghostSpotChangedByPoke;
    uint256 public ghostUnsafeTransitions; // DISPUTED/PROTECTIVE -> FRESH/WATCH directly
    uint256 public ghostSuccessfulBorrows;
    uint256 public ghostRestrictedPokes;
    uint256 public ghostRecoveries; // RECOVERING -> FRESH/WATCH

    constructor(OriginInvariantsTest t_, OriginSentinel sen_) {
        t = t_;
        sen = sen_;
    }

    function round(uint256 usd, uint256 spreadBps) external {
        usd = bound(usd, 1_000, 6_000);
        spreadBps = bound(spreadBps, 0, 300); // > 100 bps -> DISPUTED
        try t.relay(usd * 1e18, spreadBps) {} catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 26 hours));
    }

    function feeder(uint256 usd) external {
        t.setFeed(bound(usd, 1_000, 6_000));
    }

    function osmHop() external {
        t.hop();
    }

    function depth(uint256 d) external {
        t.setDepth(bound(d, 400, 1_000_000) * 1e18);
    }

    function honestKeeper() external {
        t.honest();
        _poke();
    }

    /// Legitimate full recovery attempt: honest data long enough for the TWAP to converge, then a new
    /// round after the recovery delay. Drives the system back to the OPEN states so borrow paths are tested.
    function honestRecovery() external {
        t.honest();
        _poke();
        vm.warp(block.timestamp + 6 hours);
        t.honest();
        _poke();
        vm.warp(block.timestamp + 1 hours);
        t.honest();
        _poke();
    }

    function poke() external {
        _poke();
    }

    function _poke() internal {
        OriginSentinel.State before = sen.state();
        uint256 spotBefore = t.protectedSpot();
        OriginSentinel.State next = sen.poke();
        if (t.protectedSpot() != spotBefore) ghostSpotChangedByPoke++;
        bool fromHard = before == OriginSentinel.State.DISPUTED || before == OriginSentinel.State.PROTECTIVE;
        bool toOpen = next == OriginSentinel.State.FRESH || next == OriginSentinel.State.WATCH;
        if (fromHard && toOpen) ghostUnsafeTransitions++;
        if (sen.isRestricted(next)) ghostRestrictedPokes++;
        if (before == OriginSentinel.State.RECOVERING && toOpen) ghostRecoveries++;
    }

    function borrow(uint256 wad) external {
        wad = bound(wad, 100e18, 60_000e18);
        bool restricted = sen.isRestricted(sen.state());
        if (t.tryBorrow(wad)) {
            ghostSuccessfulBorrows++;
            if (restricted) ghostBorrowsWhileRestricted++;
        }
    }

    function repay(uint256 wad) external {
        uint256 art = t.aliceArt();
        if (art == 0) return;
        wad = bound(wad, 1, art);
        if (art - wad < 100e18) wad = art; // Multipli dust rule
        if (!t.tryRepay(wad)) ghostFailedRepays++;
    }
}

contract OriginInvariantsTest is OriginTestBase {
    OriginHandler internal handler;

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        o.gem.mint(alice, 1_000_000e18);
        _deposit(o.protectedStack, alice, 1_000_000e18);
        handler = new OriginHandler(this, o.sentinel);
        targetContract(address(handler));
    }

    // ---- actions exposed to the handler ----
    function relay(uint256 price, uint256 spreadBps) external {
        uint256 hi = price + price * spreadBps / 10_000;
        _submit(_p(price, (price + hi) / 2, hi));
    }

    function setFeed(uint256 usd) external {
        _setMarketPrice(usd);
    }

    function hop() external {
        vm.warp(block.timestamp + oc.base.osmHop);
        try o.osm.poke() {} catch {}
        o.protectedStack.spotter.poke(ILK);
    }

    function setDepth(uint256 d) external {
        vm.prank(admin);
        o.riskEngine.setMarketDepth(d);
    }

    /// Honest world: feed live at the Vat's price and a fresh agreeing round at that price.
    function honest() external {
        uint256 px = o.sentinel.vatPrice() / 1e18;
        if (px == 0) return;
        _setMarketPrice(px);
        try this.relay(px * 1e18, 0) {} catch {}
    }

    function tryBorrow(uint256 wad) external returns (bool ok) {
        vm.prank(alice);
        try o.protectedStack.vat.frob(ILK, alice, alice, alice, 0, int256(wad)) {
            ok = true;
        } catch {}
    }

    function tryRepay(uint256 wad) external returns (bool ok) {
        vm.prank(alice);
        try o.protectedStack.vat.frob(ILK, alice, alice, alice, 0, -int256(wad)) {
            ok = true;
        } catch {}
    }

    function aliceArt() external view returns (uint256) {
        return _art(o.protectedStack, alice);
    }

    function protectedSpot() external view returns (uint256) {
        return _spot(o.protectedStack);
    }

    // ---- invariants ----
    function invariant_LineNeverAboveMaxLine() public view {
        assertLe(_line(o.protectedStack), oc.base.maxLine);
    }

    function invariant_LineNeverAboveEpochCap() public view {
        assertLe(_line(o.protectedStack), o.sentinel.epochStartDebt() + oc.epoch.growthCap);
    }

    function invariant_DebtNeverAboveEpochCap() public view {
        assertLe(o.sentinel.ilkDebt(), o.sentinel.epochStartDebt() + oc.epoch.growthCap);
    }

    function invariant_RestrictedStatesHaveZeroLine() public view {
        if (o.sentinel.isRestricted(o.sentinel.state())) assertEq(_line(o.protectedStack), 0);
    }

    function invariant_NoBorrowWhileRestricted() public view {
        assertEq(handler.ghostBorrowsWhileRestricted(), 0);
    }

    function invariant_RepaymentsNeverBlocked() public view {
        assertEq(handler.ghostFailedRepays(), 0);
    }

    function invariant_PokeNeverChangesSpot() public view {
        assertEq(handler.ghostSpotChangedByPoke(), 0);
    }

    function invariant_NoDirectEscapeFromRestriction() public view {
        assertEq(handler.ghostUnsafeTransitions(), 0);
    }

    function afterInvariant() external view {
        console2.log("successful borrows", handler.ghostSuccessfulBorrows());
        console2.log("restricted pokes", handler.ghostRestrictedPokes());
        console2.log("recoveries", handler.ghostRecoveries());
    }
}
