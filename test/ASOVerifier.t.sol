// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {ASOTestBase} from "./utils/ASOTestBase.sol";
import {ASOVerifier} from "../src/ASOVerifier.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ASOVerifierTest is ASOTestBase {
    ASOVerifier internal v;

    function setUp() public override {
        super.setUp();
        v = s.verifier;
    }

    // ================================================================ happy path

    function test_AcceptsFreshQuorumRound_MedianOfThree() public {
        ASOVerifier.Status st = _submit(_p(2_490e18, 2_500e18, 2_505e18));
        assertEq(uint8(st), uint8(ASOVerifier.Status.OK));
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.OK));
        assertEq(v.price(), 2_500e18, "median");
        assertEq(v.lastNonce(), 1);
        assertEq(v.lastAcceptedNonce(), 1);
        assertEq(v.observedAt(), block.timestamp);
        assertEq(v.expiresAt(), block.timestamp + 1 hours);
        (uint256 p, ASOVerifier.Status gs) = v.getPrice(PROFILE_ID);
        assertEq(p, 2_500e18);
        assertEq(uint8(gs), uint8(ASOVerifier.Status.OK));
    }

    function test_MedianIsOrderIndependent_UnsortedPrices() public {
        _submit(_p(2_505e18, 2_490e18, 2_500e18));
        assertEq(v.price(), 2_500e18);
    }

    function test_MedianOfFour_AveragesMiddleTwo() public {
        uint256[] memory p = new uint256[](4);
        (p[0], p[1], p[2], p[3]) = (2_500e18, 2_502e18, 2_498e18, 2_504e18);
        _submit(p);
        assertEq(v.price(), (2_500e18 + 2_502e18) / 2);
    }

    function test_AllFiveSourcesAccepted() public {
        uint256[] memory p = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            p[i] = 2_500e18 + i * 1e18;
        }
        _submit(p);
        assertEq(v.price(), 2_502e18);
    }

    function test_InitialStatusIsNoData() public view {
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.NO_DATA));
    }

    // ================================================================ quorum / sources

    function test_RevertWhen_QuorumNotMet() public {
        uint256[] memory p = new uint256[](2);
        (p[0], p[1]) = (2_500e18, 2_500e18);
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(p, 1);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.QuorumNotMet.selector, 2, 3));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_EmptyRound() public {
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.QuorumNotMet.selector, 0, 3));
        v.submitRound(new ASOVerifier.PriceAttestation[](0), new bytes[](0));
    }

    function test_RevertWhen_LengthMismatch() public {
        (ASOVerifier.PriceAttestation[] memory atts,) = _round(_p3(2_500), 1);
        vm.expectRevert(ASOVerifier.LengthMismatch.selector);
        v.submitRound(atts, new bytes[](2));
    }

    function test_RevertWhen_DuplicateSource() public {
        // the same source signs twice to fake a 3-of-5 quorum
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[2] = atts[1];
        sigs[2] = sigs[1];
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.SignersNotStrictlyAscending.selector, 2));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_SourcesNotAscending() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        (atts[0], atts[1]) = (atts[1], atts[0]);
        (sigs[0], sigs[1]) = (sigs[1], sigs[0]);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.SignersNotStrictlyAscending.selector, 1));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_UnauthorizedSigner() public {
        (address outsider, uint256 key) = makeAddrAndKey("outsider");
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[0].source = outsider;
        sigs[0] = _sign(key, atts[0]); // perfectly valid signature, but not an authorised source
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.UnauthorizedSigner.selector, outsider));
        v.submitRound(atts, sigs);
    }

    // ================================================================ signatures

    function test_RevertWhen_SignatureIsGarbage() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        sigs[1] = hex"deadbeef";
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSignature.selector, 1));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_PriceTamperedAfterSigning() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[0].price = 5_000e18; // relayer edits the signed price
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSignature.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_SignedByOtherSourceKey() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        sigs[0] = _sign(signerKeys[4], atts[0]); // source 4 signs an attestation claiming source 0
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSignature.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_HighSMalleableSignature() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        (uint8 v_, bytes32 r, bytes32 sv) = vm.sign(signerKeys[0], v.attestationDigest(atts[0]));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        sigs[0] = abi.encodePacked(r, bytes32(n - uint256(sv)), v_ == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSignature.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_SignatureFromOtherChain() public {
        // Sources sign on chain 31337; the same payload submitted on another chain id must fail.
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSignature.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_SignatureForOtherVerifierContract() public {
        ASOVerifier other = new ASOVerifier(PROFILE_ID, admin, guardian, signerAddrs, 3, 1 hours, 2 hours, 100);
        ASOVerifier.PriceAttestation[] memory atts = new ASOVerifier.PriceAttestation[](3);
        bytes[] memory sigs = new bytes[](3);
        for (uint256 i; i < 3; ++i) {
            atts[i] = _att(2_500e18, 1, signerAddrs[i]);
            sigs[i] = _signFor(other, signerKeys[i], atts[i]); // signed for `other`
        }
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSignature.selector, 0));
        v.submitRound(atts, sigs);
        // ...but they are valid where they were meant to go
        other.submitRound(atts, sigs);
        assertEq(other.price(), 2_500e18);
    }

    function test_DomainSeparatorBindsChainIdAndContract() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ASO Verifier"),
                keccak256("1"),
                block.chainid,
                address(v)
            )
        );
        assertEq(v.domainSeparator(), expected);
        ASOVerifier.PriceAttestation memory a = _att(2_500e18, 1, signerAddrs[0]);
        bytes32 structHash = keccak256(
            abi.encode(v.ATTESTATION_TYPEHASH(), a.profileId, a.price, a.validAfter, a.validUntil, a.nonce, a.source)
        );
        assertEq(v.attestationDigest(a), keccak256(abi.encodePacked(hex"1901", expected, structHash)));
    }

    function test_RevertWhen_RemovingUnknownSigner() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSigner.selector, mallory));
        v.removeSigner(mallory);
    }

    // ================================================================ replay / nonce

    function test_RevertWhen_ExactReplayOfAcceptedRound() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        v.submitRound(atts, sigs);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.NonceNotIncreasing.selector, 1, 1));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_OldNonceAfterNewerRound() public {
        (ASOVerifier.PriceAttestation[] memory oldAtts, bytes[] memory oldSigs) = _round(_p3(2_500), 5);
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 6);
        v.submitRound(atts, sigs);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.NonceNotIncreasing.selector, 5, 6));
        v.submitRound(oldAtts, oldSigs);
    }

    function test_RevertWhen_ReplayOfDisputedRound() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p(2_000e18, 2_500e18, 2_500e18), 1);
        v.submitRound(atts, sigs);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.NonceNotIncreasing.selector, 1, 1));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_MixedNoncesInRound() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[2].nonce = 2;
        sigs[2] = _sign(signerKeys[2], atts[2]);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.NonceMismatch.selector, 2));
        v.submitRound(atts, sigs);
    }

    function test_NonceGapsAreAllowedButMonotonic() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 10);
        v.submitRound(atts, sigs);
        assertEq(v.lastNonce(), 10);
    }

    // ================================================================ freshness / expiry / validity

    function test_RevertWhen_AttestationExpired() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        vm.warp(block.timestamp + 1 hours + 1); // validUntil = t + 1h
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.Expired.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_AcceptsAtExactExpiryInstant() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        vm.warp(block.timestamp + 1 hours);
        v.submitRound(atts, sigs);
        assertEq(v.lastAcceptedNonce(), 1);
    }

    function test_RevertWhen_ObservationOlderThanMaxAge() public {
        ASOVerifier.PriceAttestation[] memory atts = new ASOVerifier.PriceAttestation[](3);
        bytes[] memory sigs = new bytes[](3);
        for (uint256 i; i < 3; ++i) {
            atts[i] = _att(2_500e18, 1, signerAddrs[i]);
            atts[i].validAfter = uint64(block.timestamp - 1 hours - 1); // older than maxAge
            atts[i].validUntil = uint64(block.timestamp + 30 minutes); // but not expired
            sigs[i] = _sign(signerKeys[i], atts[i]);
        }
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.StaleAttestation.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_FutureDatedObservation() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[1].validAfter = uint64(block.timestamp + 1);
        sigs[1] = _sign(signerKeys[1], atts[1]);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.NotYetValid.selector, 1));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_ValidityWindowTooLong() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[0].validUntil = uint64(block.timestamp + 2 hours + 1); // > maxValidity
        sigs[0] = _sign(signerKeys[0], atts[0]);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidValidityWindow.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_ValidUntilNotAfterValidAfter() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[0].validUntil = atts[0].validAfter;
        sigs[0] = _sign(signerKeys[0], atts[0]);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidValidityWindow.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_NewRoundCarriesOlderObservation() public {
        _submitAgreeing(2_500); // observedAt = T
        ASOVerifier.PriceAttestation[] memory atts = new ASOVerifier.PriceAttestation[](3);
        bytes[] memory sigs = new bytes[](3);
        vm.warp(block.timestamp + 10 minutes);
        for (uint256 i; i < 3; ++i) {
            atts[i] = _att(2_500e18, 2, signerAddrs[i]);
            atts[i].validAfter = uint64(block.timestamp - 20 minutes); // before T
            sigs[i] = _sign(signerKeys[i], atts[i]);
        }
        vm.expectRevert(ASOVerifier.ObservationOlderThanCurrent.selector);
        v.submitRound(atts, sigs);
    }

    function test_StatusBecomesStaleAfterMaxAge_WithoutAnyTransaction() public {
        _submitAgreeing(2_500);
        vm.warp(block.timestamp + 1 hours); // exactly maxAge and exactly validUntil: still OK
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.OK));
        vm.warp(block.timestamp + 1);
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.STALE));
        (uint256 p, ASOVerifier.Status st) = v.getPrice(PROFILE_ID);
        assertEq(p, 2_500e18, "price is kept but flagged");
        assertEq(uint8(st), uint8(ASOVerifier.Status.STALE));
    }

    function test_StatusBecomesStaleAtEarliestSourceExpiry() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[2].validUntil = uint64(block.timestamp + 10 minutes); // one source expires early
        sigs[2] = _sign(signerKeys[2], atts[2]);
        v.submitRound(atts, sigs);
        assertEq(v.expiresAt(), block.timestamp + 10 minutes);
        vm.warp(block.timestamp + 10 minutes + 1);
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.STALE));
    }

    // ================================================================ disagreement

    function test_DivergentRoundIsDisputed_PriceUnchanged() public {
        _submitAgreeing(2_500);
        vm.warp(block.timestamp + 1 minutes);
        ASOVerifier.Status st = _submit(_p(2_000e18, 2_500e18, 2_500e18)); // 20% spread
        assertEq(uint8(st), uint8(ASOVerifier.Status.DISPUTED));
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.DISPUTED));
        assertEq(v.price(), 2_500e18, "accepted price untouched");
        assertEq(v.lastNonce(), 2, "nonce consumed");
        assertEq(v.lastAcceptedNonce(), 1);
    }

    function test_DisputeClearedOnlyByNewAgreeingRound() public {
        _submit(_p(2_000e18, 2_500e18, 2_500e18));
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.DISPUTED));
        vm.warp(block.timestamp + 5 minutes);
        _submitAgreeing(2_400);
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.OK));
        assertEq(v.price(), 2_400e18);
    }

    function test_SpreadExactlyAtToleranceIsAccepted() public {
        // (2525 - 2500) / 2500 = 1.00% = 100 bps = maxDeviationBps
        ASOVerifier.Status st = _submit(_p(2_500e18, 2_500e18, 2_525e18));
        assertEq(uint8(st), uint8(ASOVerifier.Status.OK));
    }

    function test_SpreadOneWeiAboveToleranceIsDisputed() public {
        // spread rounds UP, so 1 wei over 1.00% is not accepted
        ASOVerifier.Status st = _submit(_p(2_500e18, 2_500e18, 2_525e18 + 1));
        assertEq(uint8(st), uint8(ASOVerifier.Status.DISPUTED));
    }

    // ================================================================ input validation

    function test_RevertWhen_ZeroPrice() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p(0, 2_500e18, 2_500e18), 1);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidPrice.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_PriceAboveUint128() public {
        uint256 big = uint256(type(uint128).max) + 1;
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p(big, big, big), 1);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidPrice.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_WrongProfile() public {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        atts[0].profileId = keccak256("XAU/USD");
        sigs[0] = _sign(signerKeys[0], atts[0]);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.WrongProfile.selector, 0));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_GetPriceWrongProfile() public {
        vm.expectRevert(ASOVerifier.WrongProfileId.selector);
        v.getPrice(keccak256("XAU/USD"));
    }

    // ================================================================ halt

    function test_GuardianHalts_SubmissionsRefused_OnlyOwnerUnhalts() public {
        _submitAgreeing(2_500);
        vm.prank(guardian);
        v.halt();
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.HALTED));

        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 2);
        vm.expectRevert(ASOVerifier.IsHalted.selector);
        v.submitRound(atts, sigs);

        vm.prank(guardian);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, guardian));
        v.unhalt();

        vm.prank(admin);
        v.unhalt();
        assertEq(uint8(v.status()), uint8(ASOVerifier.Status.OK));
    }

    function test_RevertWhen_StrangerHalts() public {
        vm.prank(mallory);
        vm.expectRevert(ASOVerifier.NotGuardianOrOwner.selector);
        v.halt();
    }

    // ================================================================ admin

    function test_RevertWhen_NonOwnerChangesSourceSet() public {
        vm.startPrank(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        v.addSigner(mallory);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        v.removeSigner(signerAddrs[0]);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        v.setQuorum(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        v.setParams(1 days, 1 days, 2_000);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, mallory));
        v.setGuardian(mallory);
        vm.stopPrank();
    }

    function test_QuorumMustBeStrictMajority() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidQuorum.selector, 2, 5));
        v.setQuorum(2); // 2-of-5 would allow two disjoint "quorums"
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidQuorum.selector, 6, 5));
        v.setQuorum(6);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidQuorum.selector, 0, 5));
        v.setQuorum(0);
        v.setQuorum(5);
        assertEq(v.quorum(), 5);
        vm.stopPrank();
    }

    function test_AddingSignerThatBreaksMajorityReverts() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidQuorum.selector, 3, 6));
        v.addSigner(makeAddr("sixth")); // 3-of-6 is not a strict majority
    }

    function test_RemovingSignerBelowQuorumReverts() public {
        vm.startPrank(admin);
        v.setQuorum(5);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidQuorum.selector, 5, 4));
        v.removeSigner(signerAddrs[0]);
        vm.stopPrank();
    }

    function test_RemovedSignerCanNoLongerContribute() public {
        vm.startPrank(admin);
        v.removeSigner(signerAddrs[0]); // 3-of-4 is still a strict majority
        vm.stopPrank();
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.UnauthorizedSigner.selector, signerAddrs[0]));
        v.submitRound(atts, sigs);
    }

    function test_RevertWhen_InvalidSignerAddress() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSigner.selector, address(0)));
        v.addSigner(address(0));
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSigner.selector, signerAddrs[1]));
        v.addSigner(signerAddrs[1]);
        vm.stopPrank();
    }

    function test_ParamBounds() public {
        vm.startPrank(admin);
        vm.expectRevert(ASOVerifier.InvalidParams.selector);
        v.setParams(59, 1 hours, 100);
        vm.expectRevert(ASOVerifier.InvalidParams.selector);
        v.setParams(1 days + 1, 1 hours, 100);
        vm.expectRevert(ASOVerifier.InvalidParams.selector);
        v.setParams(1 hours, 59, 100);
        vm.expectRevert(ASOVerifier.InvalidParams.selector);
        v.setParams(1 hours, 1 hours, 0);
        vm.expectRevert(ASOVerifier.InvalidParams.selector);
        v.setParams(1 hours, 1 hours, 2_001);
        vm.stopPrank();
    }

    function test_MaxSignersEnforced() public {
        address[] memory many = new address[](17);
        for (uint256 i; i < 17; ++i) {
            many[i] = address(uint160(0x1000 + i));
        }
        vm.expectRevert(ASOVerifier.TooManySigners.selector);
        new ASOVerifier(PROFILE_ID, admin, guardian, many, 9, 1 hours, 2 hours, 100);
    }

    function test_OwnershipTransferIsTwoStep() public {
        vm.prank(admin);
        v.transferOwnership(mallory);
        assertEq(v.owner(), admin, "not transferred until accepted");
        vm.prank(mallory);
        v.acceptOwnership();
        assertEq(v.owner(), mallory);
    }

    // ================================================================ fuzz

    function testFuzz_MedianWithinMinMax(uint96 a, uint96 b, uint96 c) public {
        a = uint96(bound(a, 1e18, 1e24));
        // keep within 1% of a so the round is accepted
        b = uint96(bound(b, a, uint256(a) * 10_050 / 10_000));
        c = uint96(bound(c, uint256(a) * 9_960 / 10_000, a));
        _submit(_p(a, b, c));
        uint256 lo = a < b ? (a < c ? a : c) : (b < c ? b : c);
        uint256 hi = a > b ? (a > c ? a : c) : (b > c ? b : c);
        if (v.lastAcceptedNonce() == 1) {
            assertGe(v.price(), lo);
            assertLe(v.price(), hi);
        } else {
            assertTrue(v.lastRoundDisputed());
        }
    }

    function testFuzz_AnyTamperedFieldInvalidatesSignature(uint8 field, uint64 delta) public {
        vm.assume(delta != 0);
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), 1);
        ASOVerifier.PriceAttestation memory a = atts[0];
        field = uint8(bound(field, 0, 3));
        if (field == 0) a.price = a.price + delta;
        else if (field == 1) a.validAfter = a.validAfter - uint64(bound(delta, 1, 30 minutes));
        else if (field == 2) a.validUntil = a.validUntil - uint64(bound(delta, 1, 30 minutes));
        else a.profileId = keccak256(abi.encode(delta));
        atts[0] = a;
        if (field == 3) vm.expectRevert(abi.encodeWithSelector(ASOVerifier.WrongProfile.selector, 0));
        else vm.expectRevert(abi.encodeWithSelector(ASOVerifier.InvalidSignature.selector, 0));
        v.submitRound(atts, sigs);
        assertEq(v.lastNonce(), 0);
    }

    function testFuzz_ReplayAlwaysRejected(uint64 nonce) public {
        nonce = uint64(bound(nonce, 1, type(uint64).max));
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(_p3(2_500), nonce);
        v.submitRound(atts, sigs);
        vm.expectRevert(abi.encodeWithSelector(ASOVerifier.NonceNotIncreasing.selector, nonce, nonce));
        v.submitRound(atts, sigs);
    }
}
