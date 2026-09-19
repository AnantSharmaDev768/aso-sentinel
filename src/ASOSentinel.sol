// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IVat, ISpotter, IPriceFeedAdapter} from "./interfaces/IMultipli.sol";
import {ASOVerifier} from "./ASOVerifier.sol";

/// @title ASOSentinel — oracle-aware debt-ceiling controller for one Vat collateral type (prototype)
/// @notice Permissionless `poke()` sets the ilk's debt ceiling (`line`) from oracle health:
///   - unhealthy oracle data  -> line = 0: every new-debt frob reverts `Vat/ceiling-exceeded`,
///     while repayments (dart <= 0) are unaffected because the Vat skips the ceiling check for them.
///   - healthy oracle data    -> line = min(currentDebt + gap, maxLine) (DssAutoLine-style headroom),
///     so if nobody pokes after data goes bad, at most the remaining headroom can still be borrowed.
///
/// The Sentinel NEVER changes the collateral price (`spot`). Invalidating the price would make
/// Multipli's Spotter write spot = 0 and expose every vault to liquidation; restricting new debt
/// is the safer action. The only Vat call this contract can make is `file(ilk, "line", x)`.
///
/// Health checks, in order:
///   1. ASO verifier status must be OK (not HALTED / DISPUTED / NO_DATA / STALE)
///   2. Multipli's own PriceFeedAdapter must report a valid feed (the OSM ignores this signal)
///   3. The price the Vat currently lends against must not exceed the fresh attested price
///      by more than maxPriceGapBps (detects an OSM serving a stale, higher price)
/// After any restriction, recovery additionally requires a NEW accepted ASO round.
contract ASOSentinel is Ownable2Step {
    enum Reason {
        HEALTHY,
        ASO_HALTED,
        ASO_DISPUTED,
        ASO_NO_DATA,
        ASO_STALE,
        FEED_STALE,
        VAT_PRICE_ABOVE_ATTESTED,
        AWAITING_FRESH_ROUND
    }

    uint256 internal constant RAY = 1e27;
    uint256 internal constant BPS = 10_000;

    IVat public immutable vat;
    ISpotter public immutable spotter;
    IPriceFeedAdapter public immutable feed;
    ASOVerifier public immutable verifier;
    bytes32 public immutable ilk;

    uint256 public maxLine; // [rad] hard cap; the Sentinel never sets line above this
    uint256 public gap; // [rad] headroom above current debt opened by a healthy poke
    uint16 public maxPriceGapBps; // tolerated excess of the Vat's price over the attested price

    bool public restricted;
    uint64 public restrictedAtNonce; // verifier.lastNonce() when the current restriction began
    Reason public lastReason;

    event Poked(address indexed caller, Reason reason, uint256 oldLine, uint256 newLine);
    event Restricted(Reason reason, uint64 atNonce);
    event Recovered(uint64 withNonce);
    event LimitsSet(uint256 maxLine, uint256 gap, uint16 maxPriceGapBps);

    error InvalidLimits();

    constructor(
        IVat vat_,
        ISpotter spotter_,
        IPriceFeedAdapter feed_,
        ASOVerifier verifier_,
        bytes32 ilk_,
        address owner_,
        uint256 maxLine_,
        uint256 gap_,
        uint16 maxPriceGapBps_
    ) Ownable(owner_) {
        vat = vat_;
        spotter = spotter_;
        feed = feed_;
        verifier = verifier_;
        ilk = ilk_;
        _setLimits(maxLine_, gap_, maxPriceGapBps_);
        // Fail closed: borrowing opens only after the first healthy poke backed by an accepted round.
        restricted = true;
        lastReason = Reason.ASO_NO_DATA;
    }

    // =====================================================================
    // Views
    // =====================================================================

    /// @notice Oracle health as the Sentinel sees it right now (ignores the recovery gate).
    function evaluate() public view returns (Reason) {
        ASOVerifier.Status s = verifier.status();
        if (s == ASOVerifier.Status.HALTED) return Reason.ASO_HALTED;
        if (s == ASOVerifier.Status.DISPUTED) return Reason.ASO_DISPUTED;
        if (s == ASOVerifier.Status.NO_DATA) return Reason.ASO_NO_DATA;
        if (s == ASOVerifier.Status.STALE) return Reason.ASO_STALE;

        // Multipli's adapter already knows when its Chainlink feed is stale; the OSM discards that
        // signal and keeps serving its cached price. A reverting feed is treated as stale (fail closed).
        try feed.peek() returns (bytes32, bool has) {
            if (!has) return Reason.FEED_STALE;
        } catch {
            return Reason.FEED_STALE;
        }

        // Only an OVER-valued Vat price is unsafe; a Vat price below the attested price is conservative.
        if (vatPrice() * BPS > verifier.price() * (BPS + maxPriceGapBps)) return Reason.VAT_PRICE_ABOVE_ATTESTED;
        return Reason.HEALTHY;
    }

    /// @notice Collateral price [wad] implied by the Vat's `spot`, inverting Spotter.poke:
    /// spot = price * 1e9 * RAY / par * RAY / mat  =>  price = spot * mat / RAY * par / RAY / 1e9.
    /// Rounded up so the comparison errs towards restricting.
    function vatPrice() public view returns (uint256) {
        (,, uint256 spot,,) = vat.ilks(ilk);
        (, uint256 mat) = spotter.ilks(ilk);
        uint256 withMat = Math.mulDiv(spot, mat, RAY, Math.Rounding.Ceil);
        return Math.ceilDiv(Math.mulDiv(withMat, spotter.par(), RAY, Math.Rounding.Ceil), 1e9);
    }

    /// @notice Total debt of the ilk [rad].
    function ilkDebt() public view returns (uint256) {
        (uint256 Art, uint256 rate,,,) = vat.ilks(ilk);
        return Art * rate;
    }

    // =====================================================================
    // Poke (permissionless)
    // =====================================================================

    function poke() external returns (Reason reason) {
        reason = evaluate();
        (,,, uint256 oldLine,) = vat.ilks(ilk);

        if (reason == Reason.HEALTHY) {
            if (restricted) {
                uint64 accepted = verifier.lastAcceptedNonce();
                if (accepted > restrictedAtNonce) {
                    restricted = false;
                    emit Recovered(accepted);
                } else {
                    reason = Reason.AWAITING_FRESH_ROUND;
                }
            }
        } else if (!restricted) {
            restricted = true;
            restrictedAtNonce = verifier.lastNonce();
            emit Restricted(reason, restrictedAtNonce);
        }

        uint256 newLine = 0; // any non-HEALTHY outcome closes the ceiling
        if (reason == Reason.HEALTHY) {
            newLine = Math.min(ilkDebt() + gap, maxLine);
        }
        if (newLine != oldLine) vat.file(ilk, "line", newLine);

        lastReason = reason;
        emit Poked(msg.sender, reason, oldLine, newLine);
    }

    // =====================================================================
    // Administration
    // =====================================================================

    function setLimits(uint256 maxLine_, uint256 gap_, uint16 maxPriceGapBps_) external onlyOwner {
        _setLimits(maxLine_, gap_, maxPriceGapBps_);
    }

    function _setLimits(uint256 maxLine_, uint256 gap_, uint16 maxPriceGapBps_) internal {
        if (gap_ == 0 || gap_ > maxLine_ || maxPriceGapBps_ > 5_000) revert InvalidLimits();
        maxLine = maxLine_;
        gap = gap_;
        maxPriceGapBps = maxPriceGapBps_;
        emit LimitsSet(maxLine_, gap_, maxPriceGapBps_);
    }
}
