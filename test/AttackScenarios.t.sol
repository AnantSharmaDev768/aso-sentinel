// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {ASOTestBase} from "./utils/ASOTestBase.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";
import {ASOSentinel} from "../src/ASOSentinel.sol";

/// @notice The demo scenarios, as deterministic tests. BASELINE = Multipli's verified Vat/Spotter/OSM/
/// PriceFeedAdapter with no protection. PROTECTED = the same contracts + ASOSentinel/ASOVerifier.
/// Both read the same OSM, so any difference in outcome is caused by the Sentinel alone.
contract AttackScenariosTest is ASOTestBase {
    uint256 internal constant ALICE_INK = 100e18; // 100 mPAXG
    uint256 internal constant ALICE_DEBT = 100_000e18; // 100k rwaUSD

    function setUp() public override {
        super.setUp();
        // Healthy start: fresh agreeing attestations, Sentinel opens headroom on the protected Vat.
        _submitAgreeing(2_500);
        assertEq(uint8(s.sentinel.poke()), uint8(ASOSentinel.Reason.HEALTHY));
        // Alice is an existing, healthy borrower on both systems.
        _deposit(s.baseline, alice, ALICE_INK);
        _deposit(s.protectedStack, alice, ALICE_INK);
        _borrow(s.baseline, alice, ALICE_DEBT);
        _borrow(s.protectedStack, alice, ALICE_DEBT);
    }

    // ------------------------------------------------------------------ 1. valid fresh data

    function test_S1_ValidFreshAttestations_BorrowingSucceeds() public {
        _deposit(s.protectedStack, mallory, 10e18);
        _borrow(s.protectedStack, mallory, 10_000e18);
        assertEq(_art(s.protectedStack, mallory), 10_000e18);
        assertEq(s.protectedStack.vat.rwaUSD(mallory), 10_000 * RAD, "rwaUSD minted");
    }

    // ------------------------------------------------------------------ 2. stale / expired

    function test_S2_ExpiredAttestationRejected_AndStaleDataBlocksBorrowing() public {
        // (a) an expired attestation round cannot be submitted
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 99);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.Expired.selector, 0));
        s.verifier.submitRound(atts, sigs);

        // (b) the accepted price has aged out -> Sentinel closes the ceiling -> new debt reverts
        assertEq(uint8(s.verifier.status()), uint8(ASOVerifier.Status.STALE));
        assertEq(uint8(s.sentinel.poke()), uint8(ASOSentinel.Reason.ASO_STALE));
        _deposit(s.protectedStack, mallory, 10e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, mallory, 1e18);
    }

    // ------------------------------------------------------------------ 3. divergent sources

    function test_S3_DivergentSources_Disputed_BorrowingRestricted() public {
        ASOVerifier.Status st = _submit(_p(1_500e18, 2_500e18, 2_510e18));
        assertEq(uint8(st), uint8(ASOVerifier.Status.DISPUTED));
        assertEq(s.verifier.price(), 2_500e18, "disputed round does not move the price");
        assertEq(uint8(s.sentinel.poke()), uint8(ASOSentinel.Reason.ASO_DISPUTED));
        _deposit(s.protectedStack, mallory, 10e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, mallory, 1e18);
    }

    // ------------------------------------------------------------------ 4. invalid signature

    function test_S4_InvalidSignature_Reverts() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 2);
        atts[1].price = 9_999e18; // forged price under a real source's signature
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSignature.selector, 1));
        s.verifier.submitRound(atts, sigs);
        assertEq(s.verifier.lastNonce(), 1, "no state change");
    }

    // ------------------------------------------------------------------ 5. replay

    function test_S5_ReplayedRound_Reverts() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 2);
        s.verifier.submitRound(atts, sigs);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.NonceNotIncreasing.selector, 2, 2));
        s.verifier.submitRound(atts, sigs);
    }

    // ------------------------------------------------------------------ 6. feeder stops: baseline vs protected

    /// Feeder freezes at $2,500 while the market falls to $1,500. Independent sources attest $1,500.
    function test_S6a_FrozenFeedAndMarketDrop_BaselineMintsBadDebt_ProtectedBlocks() public {
        // Market falls; the Chainlink-style feeder does not update. Sources attest the real price.
        _submitAgreeing(1_500);
        _advanceOsmHop(); // OSM keeps 2,500 (nothing new from the feed)
        _submitAgreeing(1_500);
        (uint256 osmVal, bool osmHas) = _osmPrice();
        assertEq(osmVal, 2_500e18, "OSM still at stale price");
        assertTrue(osmHas);

        _deposit(s.baseline, mallory, 100e18);
        _deposit(s.protectedStack, mallory, 100e18);

        // BASELINE: borrow the maximum the stale price allows: 100 * 2500 / 1.4 = 178,571 rwaUSD
        _borrow(s.baseline, mallory, 178_571e18);
        uint256 crBps = _collateralRatioBps(s.baseline, mallory, 1_500);
        assertLt(crBps, 10_000, "baseline: debt exceeds collateral value at the real price (bad debt)");
        emit log_named_uint("baseline attacker collateral ratio at real price [bps]", crBps);

        // PROTECTED: Sentinel sees the Vat lending above the fresh attested price and closes the ceiling.
        assertEq(uint8(s.sentinel.poke()), uint8(ASOSentinel.Reason.VAT_PRICE_ABOVE_ATTESTED));
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, mallory, 178_571e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, mallory, 1e18);
        assertEq(_art(s.protectedStack, mallory), 0);
    }

    /// Everything goes silent for 25h: no feeder updates and no attestations.
    function test_S6b_FeederStops25h_BaselineStillLends_ProtectedBlocks() public {
        vm.warp(block.timestamp + 25 hours);
        s.osm.poke(); // anyone may poke; it silently does nothing because the adapter reports stale
        _pokeSpotters();
        (, bool adapterOk) = s.adapter.peek();
        (uint256 osmVal, bool osmHas) = _osmPrice();
        assertFalse(adapterOk, "Multipli's adapter: feed is stale");
        assertTrue(osmHas, "Multipli's OSM: still serves a price...");
        assertEq(osmVal, 2_500e18, "...25 hours old");

        _deposit(s.baseline, mallory, 100e18);
        _deposit(s.protectedStack, mallory, 100e18);
        _borrow(s.baseline, mallory, 150_000e18); // BASELINE: succeeds on 25h-old data

        assertEq(uint8(s.sentinel.poke()), uint8(ASOSentinel.Reason.ASO_STALE));
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, mallory, 150_000e18); // PROTECTED: blocked
    }

    // ------------------------------------------------------------------ 7. recovery

    function test_S7_FreshValidDataAfterIncident_RestoresBorrowing() public {
        // incident: frozen feed + drop (as S6a)
        _submitAgreeing(1_500);
        assertEq(uint8(s.sentinel.poke()), uint8(ASOSentinel.Reason.VAT_PRICE_ABOVE_ATTESTED));

        // feeder resumes at the real price; the OSM needs two hops to pass it through
        _setMarketPrice(1_500);
        _advanceOsmHop();
        _advanceOsmHop();
        (uint256 osmVal,) = _osmPrice();
        assertEq(osmVal, 1_500e18);

        // still restricted until a NEW agreeing round arrives
        _submitAgreeing(1_500);
        assertEq(uint8(s.sentinel.poke()), uint8(ASOSentinel.Reason.HEALTHY));
        assertFalse(s.sentinel.restricted());
        assertEq(_line(s.protectedStack), ALICE_DEBT * 1e27 + cfg.gap);

        _deposit(s.protectedStack, mallory, 100e18);
        _borrow(s.protectedStack, mallory, 100_000e18); // 100 * 1500 / 1.4 = 107k max
        assertEq(_art(s.protectedStack, mallory), 100_000e18);
    }

    // ------------------------------------------------------------------ 8. repayments during restriction

    function test_S8_RepaymentsAndCollateralTopUpsWorkWhileRestricted() public {
        _submit(_p(1_500e18, 2_500e18, 2_510e18)); // dispute
        s.sentinel.poke();
        assertEq(_line(s.protectedStack), 0, "ceiling (0) is now BELOW current debt (100k)");

        _repay(s.protectedStack, alice, 40_000e18); // partial repay
        assertEq(_art(s.protectedStack, alice), 60_000e18);

        _deposit(s.protectedStack, alice, 10e18); // adding collateral is risk-reducing, allowed

        _repay(s.protectedStack, alice, 60_000e18); // full repay
        assertEq(_art(s.protectedStack, alice), 0);

        vm.expectRevert(bytes("Vat/ceiling-exceeded")); // but no new debt
        _borrow(s.protectedStack, alice, 1e18);
    }

    /// Why the restricted ceiling is 0 and not "current debt": with line = debt, every repayment would
    /// free room that someone else could immediately re-borrow against the bad price.
    function test_RepaidRoomCannotBeReborrowedWhileRestricted() public {
        _submitAgreeing(1_500); // Vat overvalued vs fresh attestations
        s.sentinel.poke();
        _repay(s.protectedStack, alice, 40_000e18); // frees 40k of "room" under the old debt level
        _deposit(s.protectedStack, mallory, 100e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, mallory, 40_000e18);
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, mallory, 1e18);
    }

    // ------------------------------------------------------------------ bounds and honest limitations

    /// If NOBODY pokes after data goes bad, new debt is bounded by the headroom left at the last
    /// healthy poke (line - debt), not by the stale collateral price.
    function test_KeeperLag_ExposureBoundedByHeadroom() public {
        vm.prank(admin);
        s.gem.mint(mallory, 20_000e18); // attacker with lots of collateral (10k per system)
        vm.warp(block.timestamp + 25 hours); // everything stale, no one pokes the Sentinel

        _deposit(s.protectedStack, mallory, 10_000e18);
        uint256 headroomWad = (_line(s.protectedStack) - s.sentinel.ilkDebt()) / RAY;
        assertEq(headroomWad, cfg.gap / RAY - ALICE_DEBT, "gap opened before Alice borrowed");
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(s.protectedStack, mallory, headroomWad + 1);
        _borrow(s.protectedStack, mallory, headroomWad); // worst case without a poke

        // baseline has no such bound: limited only by its governance line (1M)
        _deposit(s.baseline, mallory, 10_000e18);
        _borrow(s.baseline, mallory, 900_000e18);
    }

    /// KNOWN LIMITATION (documented, not fixed): capping `line` cannot stop collateral WITHDRAWAL,
    /// which the Vat checks against the cached spot. Closing this needs changing spot (liquidation
    /// risk) or a Vat-level hook that Multipli's Vat does not have.
    function test_KnownLimitation_CollateralWithdrawalAtStalePriceNotBlocked() public {
        _submitAgreeing(1_500); // real price 1,500; Vat still at 2,500
        s.sentinel.poke();
        assertTrue(s.sentinel.restricted());

        // Alice (100k debt) withdraws 43 of 100 mPAXG: "safe" at 2,500, insolvent at 1,500.
        vm.prank(alice);
        s.protectedStack.vat.frob(ILK, alice, alice, alice, -43e18, 0);
        assertLt(_collateralRatioBps(s.protectedStack, alice, 1_500), 10_000);
    }

    /// Multipli's own dust rule (100 rwaUSD) applies identically on both systems, restricted or not:
    /// a repayment must be full or leave >= dust. The Sentinel adds no repayment restriction of its own.
    function test_DustRuleIsMultipliBehaviour_NotSentinel() public {
        _submit(_p(1_500e18, 2_500e18, 2_510e18)); // dispute -> protected restricted
        s.sentinel.poke();
        vm.expectRevert(bytes("Vat/dust"));
        _repay(s.baseline, alice, ALICE_DEBT - 50e18);
        vm.expectRevert(bytes("Vat/dust"));
        _repay(s.protectedStack, alice, ALICE_DEBT - 50e18);
        _repay(s.protectedStack, alice, ALICE_DEBT - 100e18); // leaves exactly dust: fine
        _repay(s.protectedStack, alice, 100e18); // full repayment: fine
        assertEq(_art(s.protectedStack, alice), 0);
    }

    function test_BothSystemsShareTheSamePrice() public view {
        assertEq(_spot(s.baseline), _spot(s.protectedStack));
    }
}
