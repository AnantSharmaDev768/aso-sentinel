// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {OriginTestBase} from "./utils/OriginTestBase.sol";
import {OriginSentinel} from "../src/OriginSentinel.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";

/// @notice The state/action policy: every Sentinel state maps to a different, enforced borrowing action.
/// Also covers source availability (5/5 … 0/5 online) and coordinated manipulation (1/5 … 5/5 sources).
///
///   FRESH       line = min(debt + gap,       maxLine, epochStartDebt + growthCap)   normal borrowing
///   WATCH       line = min(debt + 25% × gap, maxLine, epochStartDebt + growthCap)   limited borrowing
///   DISPUTED    line = 0                                                          frozen, repay only
///   PROTECTIVE  line = 0                                                          frozen, repay only
///   RECOVERING  line = 0 until a newer accepted round AND the recovery delay     frozen, repay only
contract OriginPolicyTest is OriginTestBase {
    OriginSentinel internal sen;

    function setUp() public override {
        super.setUp();
        sen = o.sentinel;
    }

    // ------------------------------------------------------------------ helpers

    /// @dev Round signed by the chosen sources (indices into the ascending signer list, ascending).
    function _roundBy(uint256[] memory idx, uint256[] memory usd, uint64 nonce)
        internal
        view
        returns (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs)
    {
        atts = new ASOVerifier.PriceAttestation[](idx.length);
        sigs = new bytes[](idx.length);
        for (uint256 i; i < idx.length; ++i) {
            atts[i] = _att(usd[i] * WAD, nonce, signerAddrs[idx[i]]);
            sigs[i] = _sign(signerKeys[idx[i]], atts[i]);
        }
    }

    function _first(uint256 n) internal pure returns (uint256[] memory idx) {
        idx = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            idx[i] = i;
        }
    }

    function _same(uint256 n, uint256 usd) internal pure returns (uint256[] memory p) {
        p = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            p[i] = usd;
        }
    }

    /// @dev Honest relayer: submit, sync the history, record every presented signature.
    function _relay(uint256[] memory idx, uint256[] memory usd) internal returns (ASOVerifier.Status st) {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _roundBy(idx, usd, nextNonce++);
        st = o.verifier.submitRound(atts, sigs);
        o.riskEngine.sync();
        if (st != ASOVerifier.Status.DISPUTED) o.riskEngine.recordSources(atts, sigs);
    }

    function _debt() internal view returns (uint256) {
        return sen.ilkDebt();
    }

    function _headroom() internal view returns (uint256) {
        uint256 line = _line(o.protectedStack);
        uint256 debt = _debt();
        return line > debt ? line - debt : 0;
    }

    function _flag(uint32 f) internal view returns (bool) {
        (, uint32 flags) = sen.assess();
        return _hasFlag(flags, f);
    }

    function _assertRepayWorks() internal {
        uint256 before = _art(o.protectedStack, alice);
        _repay(o.protectedStack, alice, 1_000e18);
        assertEq(_art(o.protectedStack, alice), before - 1_000e18, "repayment must succeed");
    }

    function _assertBorrowBlocked() internal {
        vm.expectRevert(bytes("Vat/ceiling-exceeded"));
        _borrow(o.protectedStack, mallory, 1e18);
    }

    /// @dev FRESH, Alice holds 20,000 debt, Mallory holds collateral and no debt.
    function _healthyWithDebt() internal {
        _warmup(2_500);
        _deposit(o.protectedStack, alice, 100e18);
        _borrow(o.protectedStack, alice, 20_000e18);
        _deposit(o.protectedStack, mallory, 100e18);
        _assertState(_poke(), OriginSentinel.State.FRESH);
    }

    // ================================================================== state/action matrix

    function test_PolicyMatrix_ReadFromContract_DistinctPerState() public {
        _healthyWithDebt();
        uint256 debt = _debt();
        uint256 epochCapLine = sen.epochStartDebt() + oc.epoch.growthCap;
        uint256 fresh = sen.policyLine(OriginSentinel.State.FRESH);
        uint256 watch = sen.policyLine(OriginSentinel.State.WATCH);
        assertEq(fresh, _min3(debt + oc.base.gap, oc.base.maxLine, epochCapLine), "FRESH formula");
        assertEq(
            watch, _min3(debt + oc.base.gap * oc.watchGapBps / 10_000, oc.base.maxLine, epochCapLine), "WATCH formula"
        );
        assertLt(watch - debt, fresh - debt, "WATCH headroom is strictly smaller than FRESH headroom");
        assertEq(sen.policyLine(OriginSentinel.State.DISPUTED), 0);
        assertEq(sen.policyLine(OriginSentinel.State.PROTECTIVE), 0);
        assertEq(sen.policyLine(OriginSentinel.State.RECOVERING), 0);
    }

    function test_PolicyLine_IsWhatPokeApplies() public {
        _healthyWithDebt();
        assertEq(_line(o.protectedStack), sen.policyLine(OriginSentinel.State.FRESH));
        vm.warp(block.timestamp + 1 hours);
        _setMarketPrice(2_600);
        _submitAgreeing(2_600); // +4%: TWAP-watch band
        uint256 expected = sen.policyLine(OriginSentinel.State.WATCH);
        _assertState(_poke(), OriginSentinel.State.WATCH);
        assertEq(_line(o.protectedStack), expected);
    }

    function test_Fresh_PermitsNormalBorrowingUpToHeadroom() public {
        _healthyWithDebt();
        uint256 room = _headroom();
        assertEq(room, 80_000e45, "epoch cap 100k minus 20k already borrowed this epoch");
        _borrow(o.protectedStack, mallory, room / 1e27);
        _assertBorrowBlocked();
    }

    function test_Watch_ReducesCapacityButStillAllowsBorrowing() public {
        _healthyWithDebt();
        uint256 freshRoom = _headroom();
        vm.warp(block.timestamp + 1 hours);
        _setMarketPrice(2_600);
        _submitAgreeing(2_600);
        _assertState(_poke(), OriginSentinel.State.WATCH);
        uint256 watchRoom = _headroom();
        assertEq(watchRoom, oc.base.gap * oc.watchGapBps / 10_000, "25% of the gap");
        assertLt(watchRoom, freshRoom);
        _borrow(o.protectedStack, mallory, watchRoom / 1e27); // limited, not frozen
        _assertBorrowBlocked();
        _assertRepayWorks();
    }

    function test_Disputed_FreezesBorrowing_RepayAvailable() public {
        _healthyWithDebt();
        _submit(_p(1_500e18, 2_500e18, 2_510e18));
        _assertState(_poke(), OriginSentinel.State.DISPUTED);
        assertEq(_line(o.protectedStack), 0);
        _assertBorrowBlocked();
        _assertRepayWorks();
    }

    function test_Protective_FreezesBorrowing_RepayAvailable() public {
        _healthyWithDebt();
        vm.warp(block.timestamp + 1 hours);
        _setMarketPrice(4_000);
        _submitAgreeing(4_000);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        assertEq(_line(o.protectedStack), 0);
        _assertBorrowBlocked();
        _assertRepayWorks();
    }

    /// @dev attack → price briefly normalises → attack resumes: borrowing must never reopen in between.
    function test_Recovering_KeepsFreeze_UntilNewRoundAndDelay_AndReRestrictsOnRelapse() public {
        _healthyWithDebt();
        vm.warp(block.timestamp + 1 hours);
        _setMarketPrice(4_000);
        _submitAgreeing(4_000);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);

        // price normalises for a while (signals clear) → RECOVERING, still frozen
        for (uint256 i; i < 10 && _state() != OriginSentinel.State.RECOVERING; ++i) {
            vm.warp(block.timestamp + 1 hours);
            _setMarketPrice(2_500);
            _submitAgreeing(2_500);
            _poke();
        }
        _assertState(_state(), OriginSentinel.State.RECOVERING);
        assertEq(_line(o.protectedStack), 0);
        _assertBorrowBlocked();
        _assertRepayWorks();

        // relapse inside the recovery delay → straight back to PROTECTIVE, never opened
        vm.warp(block.timestamp + 10 minutes);
        _setMarketPrice(4_000);
        _submitAgreeing(4_000);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        _assertBorrowBlocked();
    }

    function test_RestrictedStates_CannotIncreaseCapacity(uint256 extraDebt) public {
        _healthyWithDebt();
        extraDebt = bound(extraDebt, 100, 60_000); // Multipli's dust: a vault holds 0 or >= 100 rwaUSD
        _borrow(o.protectedStack, mallory, extraDebt * 1e18);
        assertEq(sen.policyLine(OriginSentinel.State.DISPUTED), 0);
        assertEq(sen.policyLine(OriginSentinel.State.PROTECTIVE), 0);
        assertEq(sen.policyLine(OriginSentinel.State.RECOVERING), 0);
        assertLe(sen.policyLine(OriginSentinel.State.WATCH), sen.policyLine(OriginSentinel.State.FRESH));
    }

    // ================================================================== source availability (quorum 3 of 5)

    function test_Availability_FiveOfFive_Fresh() public {
        _healthyWithDebt();
        vm.warp(block.timestamp + 10 minutes);
        _relay(_first(5), _same(5, 2_500));
        assertFalse(_flag(sen.F_SOURCE_COVERAGE_MIN()));
        _assertState(_poke(), OriginSentinel.State.FRESH);
    }

    function test_Availability_FourOfFive_StillFresh_OneSpare() public {
        _healthyWithDebt();
        vm.warp(block.timestamp + 10 minutes);
        _relay(_first(4), _same(4, 2_500));
        assertFalse(_flag(sen.F_SOURCE_COVERAGE_MIN()));
        _assertState(_poke(), OriginSentinel.State.FRESH);
    }

    function test_Availability_ThreeOfFive_MinimumQuorum_IsWatch() public {
        _healthyWithDebt();
        vm.warp(block.timestamp + 10 minutes);
        assertEq(uint8(_relay(_first(3), _same(3, 2_500))), uint8(ASOVerifier.Status.OK), "round still valid");
        assertTrue(_flag(sen.F_SOURCE_COVERAGE_MIN()), "no redundancy left");
        _assertState(_poke(), OriginSentinel.State.WATCH);
        assertEq(_headroom(), oc.base.gap * oc.watchGapBps / 10_000, "limited borrowing");
    }

    function test_Availability_TwoOfFive_NoQuorum_ThenStaleIsProtective() public {
        _healthyWithDebt();
        uint256 lastObserved = o.verifier.observedAt();
        vm.warp(block.timestamp + 10 minutes);
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) =
            _roundBy(_first(2), _same(2, 2_500), nextNonce);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.QuorumNotMet.selector, 2, 3));
        o.verifier.submitRound(atts, sigs);
        // Until the last accepted round expires the last price is still valid: exposure is the line already set.
        _assertState(_poke(), OriginSentinel.State.FRESH);
        vm.warp(lastObserved + oc.base.maxAge + 1);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        _assertBorrowBlocked();
        _assertRepayWorks();
    }

    function test_Availability_ZeroOfFive_OutageThenRecovery() public {
        _healthyWithDebt();
        vm.warp(o.verifier.observedAt() + oc.base.maxAge + 1);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        vm.warp(block.timestamp + 2 hours);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        // sources return
        _relay(_first(5), _same(5, 2_500));
        _assertState(_poke(), OriginSentinel.State.RECOVERING);
        _assertBorrowBlocked();
        vm.warp(block.timestamp + oc.thresholds.recoveryDelay);
        _relay(_first(5), _same(5, 2_500));
        _assertState(_poke(), OriginSentinel.State.FRESH);
    }

    // ================================================================== coordinated manipulation (+60%)

    function _mix(uint256 manipulated) internal pure returns (uint256[] memory p) {
        p = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            p[i] = i < manipulated ? 4_000 : 2_500;
        }
    }

    function test_Manipulation_OneToFourOfFive_AllSignaturesRelayed_Disputed() public {
        for (uint256 k = 1; k <= 4; ++k) {
            uint256 snap = vm.snapshotState();
            _healthyWithDebt();
            vm.warp(block.timestamp + 10 minutes);
            assertEq(uint8(_relay(_first(5), _mix(k))), uint8(ASOVerifier.Status.DISPUTED), "spread > 1%");
            _assertState(_poke(), OriginSentinel.State.DISPUTED);
            _assertBorrowBlocked();
            vm.revertToState(snap);
        }
    }

    /// @dev The difficult case: a colluding majority (or all five honestly reading a manipulated market) signs a
    ///      VALID round. The verifier accepts it; only the economic layer can object.
    function test_Manipulation_ValidMajority_CryptoValidButEconomicallyProtective() public {
        for (uint256 k = 3; k <= 5; ++k) {
            uint256 snap = vm.snapshotState();
            _healthyWithDebt();
            vm.warp(block.timestamp + 10 minutes);
            assertEq(uint8(_relay(_first(k), _same(k, 4_000))), uint8(ASOVerifier.Status.OK), "cryptographically valid");
            assertEq(o.verifier.price(), 4_000e18, "the verifier now reports the manipulated price");
            _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
            assertTrue(_flag(sen.F_TWAP_DEVIATION_PROTECT()), "risk engine objects");
            _assertBorrowBlocked();
            _assertRepayWorks();
            vm.revertToState(snap);
        }
    }

    // ================================================================== verifier-level rejections

    function test_Replay_CannotCreateAFreshRound() public {
        _healthyWithDebt();
        uint64 accepted = o.verifier.lastAcceptedNonce();
        vm.warp(block.timestamp + 5 minutes);
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) =
            _roundBy(_first(5), _same(5, 2_500), nextNonce++);
        o.verifier.submitRound(atts, sigs);
        uint64 observed = o.verifier.observedAt();
        vm.warp(block.timestamp + 50 minutes);
        vm.expectRevert(); // NonceNotIncreasing
        o.verifier.submitRound(atts, sigs);
        assertEq(o.verifier.lastAcceptedNonce(), accepted + 1);
        assertEq(o.verifier.observedAt(), observed, "a replay does not refresh the data");
    }

    function test_InsufficientQuorum_IsNeverTreatedAsHealthy() public {
        // from deployment: only 2 sources ever available → no accepted round, never FRESH
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) =
            _roundBy(_first(2), _same(2, 2_500), nextNonce);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.QuorumNotMet.selector, 2, 3));
        o.verifier.submitRound(atts, sigs);
        _assertState(_poke(), OriginSentinel.State.PROTECTIVE);
        assertTrue(_flag(sen.F_ASO_NO_DATA()));
    }

    function _min3(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        uint256 m = a < b ? a : b;
        return m < c ? m : c;
    }

    // ================================================================== Vat price check (GRADED vs CONSERVATIVE)

    /// @dev Honest rally: the OSM passes a +8% price to the Vat while the 6 h TWAP still sits more than the 3% watch
    ///      band lower. The Vat lends at the current market price, not above it.
    function _rallyVatAboveTwapOnly() internal {
        _healthyWithDebt();
        vm.warp(block.timestamp + 1 hours);
        _setMarketPrice(2_700);
        _submitAgreeing(2_700);
        _advanceOsmHop();
        _advanceOsmHop();
        _setMarketPrice(2_700);
        _submitAgreeing(2_700);
        assertEq(sen.vatPrice(), 2_700e18, "Vat lends at the current market price");
    }

    function test_VatCheck_Graded_RallyAboveTwapLimitsButDoesNotFreeze() public {
        _rallyVatAboveTwapOnly();
        vm.prank(admin);
        sen.setVatCheck(OriginSentinel.VatCheck.GRADED);
        assertFalse(_flag(sen.F_VAT_ABOVE_EFFECTIVE()), "not above the current market");
        assertTrue(_flag(sen.F_VAT_ABOVE_TWAP()), "above the 6 h average by more than the watch band");
        (OriginSentinel.State target,) = sen.assess();
        assertTrue(target == OriginSentinel.State.WATCH, "limited, not frozen");
    }

    function test_VatCheck_Conservative_IsDefaultAndOriginalRule() public {
        _rallyVatAboveTwapOnly();
        assertTrue(sen.vatCheck() == OriginSentinel.VatCheck.CONSERVATIVE, "default");
        assertTrue(_flag(sen.F_VAT_ABOVE_EFFECTIVE()), "original rule: above min(attested, TWAP) + 2%");
        assertFalse(_flag(sen.F_VAT_ABOVE_TWAP()));
        (OriginSentinel.State target,) = sen.assess();
        assertTrue(target == OriginSentinel.State.PROTECTIVE);
    }

    function test_VatCheck_BothModes_StaleOsmAboveMarketFreezes() public {
        _healthyWithDebt();
        vm.warp(block.timestamp + 10 minutes);
        _submitAgreeing(2_000); // the market fell; the OSM still serves 2,500
        for (uint256 m; m < 2; ++m) {
            vm.prank(admin);
            sen.setVatCheck(OriginSentinel.VatCheck(m));
            assertTrue(_flag(sen.F_VAT_ABOVE_EFFECTIVE()), "Vat lends 25% above the market");
            (OriginSentinel.State target,) = sen.assess();
            assertTrue(target == OriginSentinel.State.PROTECTIVE);
        }
    }

    function test_VatCheck_OnlyOwner() public {
        vm.expectRevert();
        vm.prank(mallory);
        sen.setVatCheck(OriginSentinel.VatCheck.GRADED);
        assertTrue(sen.vatCheck() == OriginSentinel.VatCheck.CONSERVATIVE, "default is CONSERVATIVE");
    }
}
