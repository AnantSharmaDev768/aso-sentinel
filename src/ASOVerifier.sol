// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ASOVerifier — Attested Source Oracle verifier (prototype)
/// @notice Verifies rounds of EIP-712 signed price attestations from an N-of-M set of sources for ONE
/// price profile (e.g. PAXG/USD). Field names follow the signed-feed design described in Multipli's
/// "Collateral and Oracle Profile" docs (profileId, price, validAfter, validUntil, nonce, source);
/// this contract is our own prototype, not Multipli code.
///
/// A round is a set of attestations that all carry the same `nonce`. It is checked for: signature
/// validity, authorised and distinct sources, quorum, freshness, expiry, bounded validity window,
/// strictly increasing nonce (replay protection) and cross-source agreement. Chain and contract
/// binding come from the EIP-712 domain (chainId + verifyingContract).
///
/// Rounds whose sources disagree by more than `maxDeviationBps` are NOT reverted: they are recorded
/// as DISPUTED (consuming the nonce) so that the disagreement itself is visible on-chain and consumers
/// fail closed. The accepted price is left untouched by a disputed round.
contract ASOVerifier is EIP712, Ownable2Step {
    enum Status {
        NO_DATA, // no round has ever been accepted
        OK, // last round accepted, fresh and unexpired
        STALE, // last accepted round is older than maxAge or past its expiry
        DISPUTED, // most recent round had sources disagreeing beyond tolerance
        HALTED // manual emergency stop
    }

    struct PriceAttestation {
        bytes32 profileId; // price profile, e.g. keccak256("PAXG/USD")
        uint256 price; // USD per 1 collateral unit, 18 decimals
        uint64 validAfter; // time the source observed the price
        uint64 validUntil; // source-chosen expiry
        uint64 nonce; // round sequence number, strictly increasing per profile
        address source; // signer that produced this attestation
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "PriceAttestation(bytes32 profileId,uint256 price,uint64 validAfter,uint64 validUntil,uint64 nonce,address source)"
    );
    uint256 public constant MAX_SIGNERS = 16;
    uint256 internal constant BPS = 10_000;

    bytes32 public immutable profileId;

    // --- Source set ---
    mapping(address => bool) public isSigner;
    uint256 public signerCount;
    uint256 public quorum;

    // --- Parameters ---
    uint64 public maxAge; // max observation age, enforced at submission AND while the price is in use
    uint64 public maxValidity; // max (validUntil - validAfter) a source may sign
    uint16 public maxDeviationBps; // max (max - min) / median spread inside one round

    address public guardian;
    bool public halted;

    // --- Round state ---
    uint64 public lastNonce; // last nonce consumed (accepted or disputed)
    uint64 public lastAcceptedNonce;
    bool public lastRoundDisputed;
    uint256 public price; // median of the last accepted round
    uint64 public observedAt; // oldest validAfter in the last accepted round
    uint64 public expiresAt; // earliest validUntil in the last accepted round

    // --- Events ---
    event RoundAccepted(
        uint64 indexed nonce, uint256 median, uint256 minPrice, uint256 maxPrice, uint64 observedAt, uint64 expiresAt
    );
    event RoundDisputed(uint64 indexed nonce, uint256 median, uint256 minPrice, uint256 maxPrice, uint256 spreadBps);
    event SignerAdded(address indexed signer);
    event SignerRemoved(address indexed signer);
    event QuorumSet(uint256 quorum);
    event ParamsSet(uint64 maxAge, uint64 maxValidity, uint16 maxDeviationBps);
    event GuardianSet(address indexed guardian);
    event Halted(address indexed by);
    event Unhalted(address indexed by);

    // --- Errors ---
    error IsHalted();
    error LengthMismatch();
    error QuorumNotMet(uint256 provided, uint256 required);
    error NonceNotIncreasing(uint64 nonce, uint64 lastNonce);
    error NonceMismatch(uint256 index);
    error WrongProfile(uint256 index);
    error InvalidPrice(uint256 index);
    error NotYetValid(uint256 index);
    error Expired(uint256 index);
    error InvalidValidityWindow(uint256 index);
    error StaleAttestation(uint256 index);
    error InvalidSignature(uint256 index);
    error UnauthorizedSigner(address signer);
    error SignersNotStrictlyAscending(uint256 index);
    error ObservationOlderThanCurrent();
    error InvalidQuorum(uint256 quorum, uint256 signerCount);
    error InvalidSigner(address signer);
    error TooManySigners();
    error InvalidParams();
    error NotGuardianOrOwner();
    error WrongProfileId();

    constructor(
        bytes32 profileId_,
        address owner_,
        address guardian_,
        address[] memory signers_,
        uint256 quorum_,
        uint64 maxAge_,
        uint64 maxValidity_,
        uint16 maxDeviationBps_
    ) EIP712("ASO Verifier", "1") Ownable(owner_) {
        profileId = profileId_;
        guardian = guardian_;
        emit GuardianSet(guardian_);
        for (uint256 i; i < signers_.length; ++i) {
            _addSigner(signers_[i]);
        }
        _setQuorum(quorum_);
        _setParams(maxAge_, maxValidity_, maxDeviationBps_);
    }

    // =====================================================================
    // Reads
    // =====================================================================

    /// @notice Current oracle status. Freshness is evaluated at read time, so an accepted price
    /// silently becomes STALE once maxAge or its expiry passes — no keeper action is needed.
    function status() public view returns (Status) {
        if (halted) return Status.HALTED;
        if (lastRoundDisputed) return Status.DISPUTED;
        if (lastAcceptedNonce == 0) return Status.NO_DATA;
        if (block.timestamp > expiresAt || block.timestamp - observedAt > maxAge) return Status.STALE;
        return Status.OK;
    }

    /// @notice Read interface shaped like Multipli's documented `getPrice(profileId) -> (price, status)`.
    function getPrice(bytes32 profileId_) external view returns (uint256, Status) {
        if (profileId_ != profileId) revert WrongProfileId();
        return (price, status());
    }

    /// @notice EIP-712 digest a source must sign for `a`.
    function attestationDigest(PriceAttestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(_structHash(a));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // =====================================================================
    // Round submission (permissionless: anyone may relay signed attestations)
    // =====================================================================

    /// @param atts Attestations for one round, ordered by strictly ascending `source` address.
    /// @param sigs 65-byte ECDSA signatures, sigs[i] over attestationDigest(atts[i]).
    /// @return The resulting status (OK or DISPUTED).
    function submitRound(PriceAttestation[] calldata atts, bytes[] calldata sigs) external returns (Status) {
        if (halted) revert IsHalted();
        uint256 n = atts.length;
        if (n != sigs.length) revert LengthMismatch();
        if (n < quorum) revert QuorumNotMet(n, quorum); // quorum >= 1 is an invariant, so n >= 1 below

        uint64 nonce = atts[0].nonce;
        if (nonce <= lastNonce) revert NonceNotIncreasing(nonce, lastNonce);

        uint256[] memory prices = new uint256[](n);
        address prev; // address(0): first signer must be > 0, and signers are never address(0)
        uint64 minAfter = type(uint64).max;
        uint64 minUntil = type(uint64).max;

        for (uint256 i; i < n; ++i) {
            PriceAttestation calldata a = atts[i];
            if (a.profileId != profileId) revert WrongProfile(i);
            if (a.nonce != nonce) revert NonceMismatch(i);
            if (a.price == 0 || a.price > type(uint128).max) revert InvalidPrice(i);
            if (a.validAfter > block.timestamp) revert NotYetValid(i);
            if (block.timestamp > a.validUntil) revert Expired(i);
            if (a.validUntil <= a.validAfter || a.validUntil - a.validAfter > maxValidity) {
                revert InvalidValidityWindow(i);
            }
            if (block.timestamp - a.validAfter > maxAge) revert StaleAttestation(i);

            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(attestationDigest(a), sigs[i]);
            if (err != ECDSA.RecoverError.NoError || signer != a.source) revert InvalidSignature(i);
            if (!isSigner[signer]) revert UnauthorizedSigner(signer);
            if (signer <= prev) revert SignersNotStrictlyAscending(i); // blocks duplicate sources
            prev = signer;

            prices[i] = a.price;
            if (a.validAfter < minAfter) minAfter = a.validAfter;
            if (a.validUntil < minUntil) minUntil = a.validUntil;
        }

        // A later round may not carry older observations than the price currently in use.
        if (minAfter < observedAt) revert ObservationOlderThanCurrent();

        _sort(prices);
        uint256 lo = prices[0];
        uint256 hi = prices[n - 1];
        uint256 median = n % 2 == 1 ? prices[n / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2;
        // Rounded UP so a spread just above the tolerance is never accepted.
        uint256 spreadBps = Math.mulDiv(hi - lo, BPS, median, Math.Rounding.Ceil);

        lastNonce = nonce;
        if (spreadBps > maxDeviationBps) {
            lastRoundDisputed = true;
            emit RoundDisputed(nonce, median, lo, hi, spreadBps);
            return Status.DISPUTED;
        }

        lastRoundDisputed = false;
        lastAcceptedNonce = nonce;
        price = median;
        observedAt = minAfter;
        expiresAt = minUntil;
        emit RoundAccepted(nonce, median, lo, hi, minAfter, minUntil);
        return status();
    }

    // =====================================================================
    // Administration
    // =====================================================================

    function addSigner(address signer) external onlyOwner {
        _addSigner(signer);
        _checkQuorum(quorum, signerCount);
    }

    function removeSigner(address signer) external onlyOwner {
        if (!isSigner[signer]) revert InvalidSigner(signer);
        isSigner[signer] = false;
        --signerCount;
        _checkQuorum(quorum, signerCount);
        emit SignerRemoved(signer);
    }

    function setQuorum(uint256 quorum_) external onlyOwner {
        _setQuorum(quorum_);
    }

    function setParams(uint64 maxAge_, uint64 maxValidity_, uint16 maxDeviationBps_) external onlyOwner {
        _setParams(maxAge_, maxValidity_, maxDeviationBps_);
    }

    function setGuardian(address guardian_) external onlyOwner {
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @notice Emergency stop: status becomes HALTED and new rounds are refused.
    function halt() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardianOrOwner();
        halted = true;
        emit Halted(msg.sender);
    }

    /// @notice Only the owner can lift a halt. Existing data must still be fresh to read as OK.
    function unhalt() external onlyOwner {
        halted = false;
        emit Unhalted(msg.sender);
    }

    // =====================================================================
    // Internal
    // =====================================================================

    function _structHash(PriceAttestation calldata a) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(ATTESTATION_TYPEHASH, a.profileId, a.price, a.validAfter, a.validUntil, a.nonce, a.source)
        );
    }

    function _addSigner(address signer) internal {
        if (signer == address(0) || isSigner[signer]) revert InvalidSigner(signer);
        if (signerCount >= MAX_SIGNERS) revert TooManySigners();
        isSigner[signer] = true;
        ++signerCount;
        emit SignerAdded(signer);
    }

    function _setQuorum(uint256 quorum_) internal {
        _checkQuorum(quorum_, signerCount);
        quorum = quorum_;
        emit QuorumSet(quorum_);
    }

    /// @dev Quorum must be a strict majority of the source set, so two disjoint quorums can never exist
    /// and an OK status always reflects agreement of a majority of all authorised sources.
    function _checkQuorum(uint256 q, uint256 m) internal pure {
        if (q == 0 || q > m || 2 * q <= m) revert InvalidQuorum(q, m);
    }

    function _setParams(uint64 maxAge_, uint64 maxValidity_, uint16 maxDeviationBps_) internal {
        if (maxAge_ < 60 || maxAge_ > 1 days) revert InvalidParams();
        if (maxValidity_ < 60 || maxValidity_ > 1 days) revert InvalidParams();
        if (maxDeviationBps_ == 0 || maxDeviationBps_ > 2_000) revert InvalidParams();
        maxAge = maxAge_;
        maxValidity = maxValidity_;
        maxDeviationBps = maxDeviationBps_;
        emit ParamsSet(maxAge_, maxValidity_, maxDeviationBps_);
    }

    /// @dev Insertion sort; n <= MAX_SIGNERS (16) so the cost is bounded.
    function _sort(uint256[] memory a) internal pure {
        for (uint256 i = 1; i < a.length; ++i) {
            uint256 key = a[i];
            uint256 j = i;
            while (j > 0 && a[j - 1] > key) {
                a[j] = a[j - 1];
                --j;
            }
            a[j] = key;
        }
    }
}
