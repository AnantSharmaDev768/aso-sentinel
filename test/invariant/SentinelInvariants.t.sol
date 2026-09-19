// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {ASOTestBase} from "../utils/ASOTestBase.sol";
import {ASOVerifier} from "../../src/ASOVerifier.sol";
import {ASOSentinel} from "../../src/ASOSentinel.sol";
import {SystemDeployer} from "../../script/SystemDeployer.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {console2} from "forge-std/console2.sol";

/// @notice Random sequences of oracle rounds, disputes, time jumps, feeder updates, OSM hops,
/// Sentinel pokes, borrows and repays against the protected system.
contract Handler is CommonBase, StdUtils {
    SystemDeployer.System internal s;
    SentinelInvariantsTest internal t;
    bytes32 internal constant ILK = "PAXG-A";

    uint256 public ghostBorrowsWhileRestricted;
    uint256 public ghostSuccessfulBorrows;
    uint256 public ghostSuccessfulRepays;
    uint256 public ghostFailedRepays;
    uint256 public ghostSpotChangedByPoke;
    uint256 public ghostBorrowsRejectedWhileRestricted;
    uint256 public ghostRestrictedPokes;

    constructor(SentinelInvariantsTest t_) {
        t = t_;
        s = t_.system();
    }

    function submitRound(uint256 usd, uint256 spreadBps) external {
        usd = bound(usd, 500, 5_000);
        spreadBps = bound(spreadBps, 0, 300); // sometimes beyond the 100 bps tolerance -> DISPUTED
        uint256 lo = usd * 1e18;
        uint256 hi = lo + lo * spreadBps / 10_000;
        try t.relay(lo, hi) {} catch {}
    }

    /// Honest-keeper step: sources agree on the price the Vat currently uses, then the Sentinel is poked.
    /// Drives the system into the OPEN state so borrow/repay paths are actually exercised.
    function healthyRoundAndPoke() external {
        uint256 px = s.sentinel.vatPrice();
        if (px == 0) return;
        vm.prank(t.feederAddr());
        s.feed.setAnswer(int256(px / 1e10)); // live feeder at the price the Vat uses
        try t.relay(px, px) {} catch {}
        s.sentinel.poke();
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 1, 30 hours);
        vm.warp(block.timestamp + secs);
    }

    function feederUpdate(uint256 usd) external {
        usd = bound(usd, 500, 5_000);
        vm.prank(t.feederAddr());
        s.feed.setAnswer(int256(usd * 1e8));
    }

    function osmHop() external {
        vm.warp(block.timestamp + 3600);
        try s.osm.poke() {} catch {}
        s.protectedStack.spotter.poke(ILK);
    }

    function poke() external {
        (,, uint256 spotBefore,,) = s.protectedStack.vat.ilks(ILK);
        if (s.sentinel.poke() != ASOSentinel.Reason.HEALTHY) ghostRestrictedPokes++;
        (,, uint256 spotAfter,,) = s.protectedStack.vat.ilks(ILK);
        if (spotAfter != spotBefore) ghostSpotChangedByPoke++;
    }

    function borrow(uint256 wad) external {
        wad = bound(wad, 100e18, 50_000e18); // at least dust
        address who = t.borrower();
        bool wasRestricted = s.sentinel.restricted();
        vm.prank(who);
        try s.protectedStack.vat.frob(ILK, who, who, who, 0, int256(wad)) {
            ghostSuccessfulBorrows++;
            if (wasRestricted) ghostBorrowsWhileRestricted++;
        } catch {
            if (wasRestricted) ghostBorrowsRejectedWhileRestricted++;
        }
    }

    function repay(uint256 wad) external {
        address who = t.borrower();
        (, uint256 art) = s.protectedStack.vat.urns(ILK, who);
        if (art == 0) return;
        wad = bound(wad, 1, art);
        if (art - wad < 100e18) wad = art; // Multipli's Vat dust rule (100 rwaUSD): repay fully or leave >= dust
        vm.prank(who);
        try s.protectedStack.vat.frob(ILK, who, who, who, 0, -int256(wad)) {
            ghostSuccessfulRepays++;
        } catch {
            ghostFailedRepays++;
        }
    }
}

contract SentinelInvariantsTest is ASOTestBase {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        // a borrower with a large collateral position so borrow outcomes depend on the ceiling
        vm.prank(admin);
        s.gem.mint(alice, 100_000e18);
        _deposit(s.protectedStack, alice, 100_000e18);

        handler = new Handler(this);
        targetContract(address(handler));
    }

    // --- helpers exposed to the handler ---
    function system() external view returns (System memory) {
        return s;
    }

    function feederAddr() external view returns (address) {
        return feeder;
    }

    function borrower() external view returns (address) {
        return alice;
    }

    function relay(uint256 lo, uint256 hi) external {
        uint256 mid = (lo + hi) / 2;
        _submit(_p(lo, mid, hi));
    }

    // --- invariants ---

    /// The Sentinel never opens the ceiling above its governance cap.
    function invariant_LineNeverAboveMaxLine() public view {
        assertLe(_line(s.protectedStack), s.sentinel.maxLine());
    }

    /// While restricted, the ceiling is closed.
    function invariant_RestrictedImpliesZeroLine() public view {
        if (s.sentinel.restricted()) assertEq(_line(s.protectedStack), 0);
    }

    /// No new debt was ever minted while the Sentinel was in the restricted state.
    function invariant_NoBorrowWhileRestricted() public view {
        assertEq(handler.ghostBorrowsWhileRestricted(), 0);
    }

    /// Repayments that respect the Vat's own dust rule never fail, whatever the oracle state.
    function invariant_RepaymentsNeverBlocked() public view {
        assertEq(handler.ghostFailedRepays(), 0);
    }

    /// Poking the Sentinel never changes the collateral price.
    function invariant_PokeNeverChangesSpot() public view {
        assertEq(handler.ghostSpotChangedByPoke(), 0);
    }

    /// The accepted ASO price is always a real attested value (non-zero once any round was accepted).
    function invariant_AcceptedPriceNonZeroOnceAccepted() public view {
        if (s.verifier.lastAcceptedNonce() > 0) assertGt(s.verifier.price(), 0);
        assertGe(s.verifier.lastNonce(), s.verifier.lastAcceptedNonce());
    }

    /// Non-vacuity report: shows the campaign reached both the open and the restricted states.
    function afterInvariant() external view {
        console2.log("successful borrows", handler.ghostSuccessfulBorrows());
        console2.log("borrows rejected while restricted", handler.ghostBorrowsRejectedWhileRestricted());
        console2.log("restricting pokes", handler.ghostRestrictedPokes());
        console2.log("successful repays", handler.ghostSuccessfulRepays());
    }
}
