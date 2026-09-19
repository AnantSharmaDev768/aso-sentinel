// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IVat, ISpotter, IPriceFeedAdapter} from "./interfaces/IMultipli.sol";
import {ASOVerifier} from "./ASOVerifier.sol";
import {ASORiskEngine} from "./risk/ASORiskEngine.sol";
import {CostModel} from "./risk/CostModel.sol";

/// @title OriginSentinel — manipulation-cost-aware, bounded-loss debt-ceiling controller
/// @notice Superset of ASOSentinel (kept unchanged as the Sepolia-deployed core): it evaluates the same
/// data-integrity signals (verifier status, Multipli adapter staleness, Vat price vs attested price) PLUS
/// market-risk signals from ASORiskEngine (TWAP deviation, velocity, cost gate, weighted-source
/// divergence), runs a five-state machine, and caps net debt growth per epoch.
///
/// Its ONLY write to the Vat is `file(ilk, "line", x)`. It never changes the collateral price, so it cannot
/// cause liquidations; repayments are never restricted because the Vat skips the ceiling check when debt
/// decreases.
///
/// States and ceilings (on every permissionless poke()):
///   FRESH       line = min(debt + gap,            maxLine, epochStartDebt + epochGrowthCap)
///   WATCH       line = min(debt + gap * watchGap, maxLine, epochStartDebt + epochGrowthCap)
///   DISPUTED    line = 0   (sources disagree)
///   PROTECTIVE  line = 0   (integrity failure or material market risk)
///   RECOVERING  line = 0   (signals are healthy again; waiting for a NEW accepted round AND recoveryDelay)
/// DISPUTED/PROTECTIVE can never go directly to FRESH/WATCH: they always pass through RECOVERING.
contract OriginSentinel is Ownable2Step {
    enum State {
        FRESH,
        WATCH,
        DISPUTED,
        PROTECTIVE,
        RECOVERING
    }

    // --- signal flags (bitmask exposed to the dashboard) ---
    uint32 public constant F_ASO_HALTED = 1 << 0;
    uint32 public constant F_ASO_DISPUTED = 1 << 1;
    uint32 public constant F_ASO_NO_DATA = 1 << 2;
    uint32 public constant F_ASO_STALE = 1 << 3;
    uint32 public constant F_FEED_STALE = 1 << 4;
    uint32 public constant F_VAT_ABOVE_EFFECTIVE = 1 << 5;
    uint32 public constant F_TWAP_DEVIATION_PROTECT = 1 << 6;
    uint32 public constant F_VELOCITY_PROTECT = 1 << 7;
    uint32 public constant F_COST_HIGH = 1 << 8;
    uint32 public constant F_TWAP_DEVIATION_WATCH = 1 << 9;
    uint32 public constant F_VELOCITY_WATCH = 1 << 10;
    uint32 public constant F_COST_ELEVATED = 1 << 11;
    uint32 public constant F_COST_NO_DATA = 1 << 12;
    uint32 public constant F_TWAP_INSUFFICIENT = 1 << 13;
    uint32 public constant F_SOURCE_DIVERGENCE = 1 << 14;
    /// @notice The latest round's per-source record shows only the minimum quorum signing: no redundancy left,
    /// one more unavailable source stops new rounds. Degraded availability, so borrowing is limited (WATCH).
    uint32 public constant F_SOURCE_COVERAGE_MIN = 1 << 15;
    /// @notice (GRADED mode only) The Vat lends above the 6 h TWAP by more than the TWAP watch band: limit borrowing.
    uint32 public constant F_VAT_ABOVE_TWAP = 1 << 16;

    /// @notice How the Vat's lending price is checked.
    ///   CONSERVATIVE (default): Vat > min(attested, TWAP) × (1 + maxPriceGap)   → PROTECTIVE
    ///       The Vat must not lend more than the tolerance above the conservative valuation min(market, 6 h average).
    ///   GRADED (evaluated alternative, not the default):
    ///                           Vat > attested × (1 + maxPriceGap)               → PROTECTIVE
    ///                           Vat > TWAP × (1 + twapWatch)                     → WATCH
    /// GRADED was evaluated against the baseline on the main and holdout validation suites (docs/VALIDATION.md §2):
    /// it changed no TP/FN/TN/FP count, removed ~2 frozen hours per honest rally, and shortened the freeze during
    /// sustained manipulations by the same amount. It is kept only so that comparison stays reproducible.
    enum VatCheck {
        CONSERVATIVE,
        GRADED
    }

    VatCheck public vatCheck = VatCheck.CONSERVATIVE;

    uint32 public constant PROTECT_MASK = F_ASO_HALTED | F_ASO_NO_DATA | F_ASO_STALE | F_FEED_STALE
        | F_VAT_ABOVE_EFFECTIVE | F_TWAP_DEVIATION_PROTECT | F_VELOCITY_PROTECT | F_COST_HIGH;
    uint32 public constant WATCH_MASK = F_TWAP_DEVIATION_WATCH | F_VELOCITY_WATCH | F_COST_ELEVATED | F_COST_NO_DATA
        | F_TWAP_INSUFFICIENT | F_SOURCE_DIVERGENCE | F_SOURCE_COVERAGE_MIN | F_VAT_ABOVE_TWAP;

    uint256 internal constant RAY = 1e27;
    uint256 internal constant BPS = 10_000;

    struct Deps {
        IVat vat;
        ISpotter spotter;
        IPriceFeedAdapter feed;
        ASOVerifier verifier;
        ASORiskEngine riskEngine;
        bytes32 ilk;
    }

    struct Limits {
        uint256 maxLine; // [rad] hard cap
        uint256 gap; // [rad] headroom above current debt in FRESH
        uint16 watchGapBps; // share of `gap` opened in WATCH
        uint16 maxPriceGapBps; // tolerated excess of the Vat price over the effective price
    }

    struct Thresholds {
        uint16 twapWatchBps;
        uint16 twapProtectBps;
        uint32 velocityWatchBpsPerHour;
        uint32 velocityProtectBpsPerHour;
        uint16 sourceDivergenceBps; // weighted median vs verifier median
        uint32 recoveryDelay; // [s] minimum time in RECOVERING
    }

    struct EpochConfig {
        uint64 duration; // [s]
        uint256 growthCap; // [rad] max net debt growth per epoch
    }

    /// @notice Everything the dashboard needs in one read.
    struct Snapshot {
        State state;
        State previousState;
        uint64 stateSince;
        State target;
        uint32 flags;
        uint256 line; // [rad]
        uint256 debt; // [rad]
        uint256 vatPrice; // [wad]
        uint256 attestedPrice; // [wad]
        uint256 effectivePrice; // [wad]
        uint256 twap; // [wad]
        bool twapOk;
        uint256 twapCoverageBps;
        uint256 twapDeviationBps;
        uint256 velocityBpsPerHour;
        bool velocityOk;
        CostModel.Concern concern;
        CostModel.Quote costQuote;
        uint256 freshHeadroom; // [rad] headroom the FRESH state would open now
        uint64 epochStart;
        uint256 epochStartDebt; // [rad]
        uint256 epochCapLine; // [rad]
        uint64 restrictedAtNonce;
        bool recoveryRoundSeen;
        uint64 recoveryReadyAt;
    }

    IVat public immutable vat;
    ISpotter public immutable spotter;
    IPriceFeedAdapter public immutable feed;
    ASOVerifier public immutable verifier;
    ASORiskEngine public immutable riskEngine;
    bytes32 public immutable ilk;

    Limits public limits;
    Thresholds public thresholds;
    EpochConfig public epochConfig;

    State public state;
    State public previousState;
    uint64 public stateSince;
    uint32 public lastFlags;
    uint64 public restrictedAtNonce; // verifier.lastNonce() at the last poke that saw restricted-level risk
    uint64 public lastPokeAt;
    uint64 public epochStart;
    uint256 public epochStartDebt;

    event StateChanged(State indexed from, State indexed to, uint32 flags);
    event Poked(address indexed caller, State state, uint32 flags, uint256 oldLine, uint256 newLine);
    event EpochStarted(uint64 start, uint256 startDebt);
    event LimitsSet(uint256 maxLine, uint256 gap, uint16 watchGapBps, uint16 maxPriceGapBps);
    event ThresholdsSet(Thresholds t);
    event EpochConfigSet(uint64 duration, uint256 growthCap);
    event VatCheckSet(VatCheck mode);

    error InvalidLimits();
    error InvalidThresholds();
    error InvalidEpochConfig();

    constructor(Deps memory d, address owner_, Limits memory l, Thresholds memory t, EpochConfig memory e)
        Ownable(owner_)
    {
        vat = d.vat;
        spotter = d.spotter;
        feed = d.feed;
        verifier = d.verifier;
        riskEngine = d.riskEngine;
        ilk = d.ilk;
        _setLimits(l);
        _setThresholds(t);
        _setEpochConfig(e);
        // Fail closed: start PROTECTIVE until a healthy round, a new round and the recovery delay.
        state = State.PROTECTIVE;
        previousState = State.PROTECTIVE;
        stateSince = uint64(block.timestamp);
        lastFlags = F_ASO_NO_DATA;
        epochStart = uint64(block.timestamp);
        epochStartDebt = ilkDebt();
    }

    // =====================================================================
    // Views
    // =====================================================================

    /// @notice The state the signals point to right now, and the active flags (ignores the recovery gate).
    function assess() public view returns (State target, uint32 flags) {
        flags = _flags();
        target = _target(flags);
    }

    /// @notice The debt ceiling [rad] the Sentinel would set if it entered state `s` now: the state/action
    /// policy, read from the same code poke() uses. FRESH and WATCH differ only in headroom; the three
    /// restricted states always return 0.
    function policyLine(State s) external view returns (uint256) {
        return _lineFor(s);
    }

    function isRestricted(State s) public pure returns (bool) {
        return s == State.DISPUTED || s == State.PROTECTIVE || s == State.RECOVERING;
    }

    /// @notice Collateral price [wad] the Vat lends at (inverts Spotter.poke), rounded up.
    function vatPrice() public view returns (uint256) {
        (,, uint256 spot,,) = vat.ilks(ilk);
        (, uint256 mat) = spotter.ilks(ilk);
        uint256 withMat = Math.mulDiv(spot, mat, RAY, Math.Rounding.Ceil);
        return Math.ceilDiv(Math.mulDiv(withMat, spotter.par(), RAY, Math.Rounding.Ceil), 1e9);
    }

    function ilkDebt() public view returns (uint256) {
        (uint256 Art, uint256 rate,,,) = vat.ilks(ilk);
        return Art * rate;
    }

    /// @notice Epoch values as they would be after a roll at the current time.
    function currentEpoch() public view returns (uint64 start, uint256 startDebt, uint256 capLine) {
        start = epochStart;
        startDebt = epochStartDebt;
        if (block.timestamp >= uint256(epochStart) + epochConfig.duration) {
            uint256 elapsed = block.timestamp - epochStart;
            start = uint64(epochStart + (elapsed / epochConfig.duration) * epochConfig.duration);
            startDebt = ilkDebt();
        }
        capLine = startDebt + epochConfig.growthCap;
    }

    /// @notice Headroom [rad] the FRESH state would open now (used as the cost gate's extractable bound).
    function freshHeadroom() public view returns (uint256) {
        (,, uint256 capLine) = currentEpoch();
        uint256 debt = ilkDebt();
        uint256 cap = Math.min(limits.maxLine, capLine);
        if (cap <= debt) return 0;
        return Math.min(limits.gap, cap - debt);
    }

    function snapshot() external view returns (Snapshot memory s) {
        s.state = state;
        s.previousState = previousState;
        s.stateSince = stateSince;
        (s.target, s.flags) = assess();
        (,,, s.line,) = vat.ilks(ilk);
        s.debt = ilkDebt();
        s.vatPrice = vatPrice();
        _fillMarket(s);
        _fillEpochAndRecovery(s);
    }

    // =====================================================================
    // Poke (permissionless)
    // =====================================================================

    function poke() external returns (State next) {
        riskEngine.sync();
        (State target, uint32 flags) = assess();
        _rollEpoch();

        State cur = state;
        bool targetRestricted = target == State.DISPUTED || target == State.PROTECTIVE;
        if (targetRestricted) {
            next = target;
            restrictedAtNonce = verifier.lastNonce();
        } else if (cur == State.DISPUTED || cur == State.PROTECTIVE) {
            next = State.RECOVERING;
        } else if (cur == State.RECOVERING) {
            bool newRound = verifier.lastAcceptedNonce() > restrictedAtNonce;
            bool waited = block.timestamp >= uint256(stateSince) + thresholds.recoveryDelay;
            next = newRound && waited ? target : State.RECOVERING;
        } else {
            next = target;
        }

        (,,, uint256 oldLine,) = vat.ilks(ilk);
        uint256 newLine = _lineFor(next);
        if (next != cur) {
            previousState = cur;
            state = next;
            stateSince = uint64(block.timestamp);
            emit StateChanged(cur, next, flags);
        }
        lastFlags = flags;
        lastPokeAt = uint64(block.timestamp);
        if (newLine != oldLine) vat.file(ilk, "line", newLine);
        emit Poked(msg.sender, next, flags, oldLine, newLine);
    }

    // =====================================================================
    // Administration (bounded)
    // =====================================================================

    function setLimits(Limits calldata l) external onlyOwner {
        _setLimits(l);
    }

    function setThresholds(Thresholds calldata t) external onlyOwner {
        _setThresholds(t);
    }

    function setEpochConfig(EpochConfig calldata e) external onlyOwner {
        _setEpochConfig(e);
    }

    function setVatCheck(VatCheck mode) external onlyOwner {
        vatCheck = mode;
        emit VatCheckSet(mode);
    }

    // =====================================================================
    // Internal
    // =====================================================================

    function _target(uint32 f) internal pure returns (State) {
        if (f & F_ASO_DISPUTED != 0) return State.DISPUTED;
        if (f & PROTECT_MASK != 0) return State.PROTECTIVE;
        if (f & WATCH_MASK != 0) return State.WATCH;
        return State.FRESH;
    }

    function _flags() internal view returns (uint32 f) {
        ASOVerifier.Status s = verifier.status();
        if (s == ASOVerifier.Status.HALTED) f |= F_ASO_HALTED;
        else if (s == ASOVerifier.Status.DISPUTED) f |= F_ASO_DISPUTED;
        else if (s == ASOVerifier.Status.NO_DATA) f |= F_ASO_NO_DATA;
        else if (s == ASOVerifier.Status.STALE) f |= F_ASO_STALE;

        try feed.peek() returns (bytes32, bool has) {
            if (!has) f |= F_FEED_STALE;
        } catch {
            f |= F_FEED_STALE; // a reverting feed fails closed
        }

        if (verifier.lastAcceptedNonce() == 0) return f; // no price to evaluate market signals on
        f |= _priceFlags();
        f |= _costFlags();
        f |= _sourceFlags();
    }

    function _priceFlags() internal view returns (uint32 f) {
        Thresholds memory t = thresholds;
        (uint256 eff, bool twapOk) = riskEngine.effectivePrice();
        uint256 vp = vatPrice();
        if (vatCheck == VatCheck.CONSERVATIVE) {
            if (vp * BPS > eff * (BPS + limits.maxPriceGapBps)) f |= F_VAT_ABOVE_EFFECTIVE;
        } else {
            if (vp * BPS > verifier.price() * (BPS + limits.maxPriceGapBps)) f |= F_VAT_ABOVE_EFFECTIVE;
            if (twapOk && vp * BPS > eff * (BPS + t.twapWatchBps)) f |= F_VAT_ABOVE_TWAP;
        }
        if (!twapOk) {
            f |= F_TWAP_INSUFFICIENT;
        } else {
            (uint256 dev,,) = riskEngine.spotDeviation();
            if (dev >= t.twapProtectBps) f |= F_TWAP_DEVIATION_PROTECT;
            else if (dev >= t.twapWatchBps) f |= F_TWAP_DEVIATION_WATCH;
        }
        (uint256 vel,, bool vOk) = riskEngine.velocity();
        if (vOk) {
            if (vel >= t.velocityProtectBpsPerHour) f |= F_VELOCITY_PROTECT;
            else if (vel >= t.velocityWatchBpsPerHour) f |= F_VELOCITY_WATCH;
        }
    }

    function _costFlags() internal view returns (uint32 f) {
        (CostModel.Concern c,) = riskEngine.costAssessment(freshHeadroom() / RAY, _mat());
        if (c == CostModel.Concern.HIGH) f |= F_COST_HIGH;
        else if (c == CostModel.Concern.ELEVATED) f |= F_COST_ELEVATED;
        else if (c == CostModel.Concern.INSUFFICIENT_DATA) f |= F_COST_NO_DATA;
    }

    function _sourceFlags() internal view returns (uint32 f) {
        uint64 wn = riskEngine.weightedNonce();
        if (wn == 0 || wn != verifier.lastAcceptedNonce()) return 0;
        uint256 wm = riskEngine.weightedMedianPrice();
        uint256 m = verifier.price();
        uint256 diff = wm > m ? wm - m : m - wm;
        if (diff * BPS >= m * thresholds.sourceDivergenceBps) f |= F_SOURCE_DIVERGENCE;
        if (riskEngine.weightedSourceCount() <= verifier.quorum()) f |= F_SOURCE_COVERAGE_MIN;
    }

    function _mat() internal view returns (uint256 mat) {
        (, mat) = spotter.ilks(ilk);
    }

    function _lineFor(State s) internal view returns (uint256) {
        if (isRestricted(s)) return 0;
        uint256 g = s == State.WATCH ? limits.gap * limits.watchGapBps / BPS : limits.gap;
        uint256 line = ilkDebt() + g;
        line = Math.min(line, limits.maxLine);
        return Math.min(line, epochStartDebt + epochConfig.growthCap);
    }

    function _rollEpoch() internal {
        if (block.timestamp < uint256(epochStart) + epochConfig.duration) return;
        uint256 elapsed = block.timestamp - epochStart;
        epochStart = uint64(epochStart + (elapsed / epochConfig.duration) * epochConfig.duration);
        epochStartDebt = ilkDebt();
        emit EpochStarted(epochStart, epochStartDebt);
    }

    function _fillMarket(Snapshot memory s) internal view {
        s.attestedPrice = verifier.price();
        (s.effectivePrice,) = riskEngine.effectivePrice();
        (s.twap, s.twapOk, s.twapCoverageBps) = riskEngine.twap();
        (s.twapDeviationBps,,) = riskEngine.spotDeviation();
        (s.velocityBpsPerHour,, s.velocityOk) = riskEngine.velocity();
        s.freshHeadroom = freshHeadroom();
        (s.concern, s.costQuote) = riskEngine.costAssessment(s.freshHeadroom / RAY, _mat());
    }

    function _fillEpochAndRecovery(Snapshot memory s) internal view {
        (s.epochStart, s.epochStartDebt, s.epochCapLine) = currentEpoch();
        s.restrictedAtNonce = restrictedAtNonce;
        s.recoveryRoundSeen = verifier.lastAcceptedNonce() > restrictedAtNonce;
        if (state == State.RECOVERING) s.recoveryReadyAt = stateSince + thresholds.recoveryDelay;
    }

    function _setLimits(Limits memory l) internal {
        if (l.gap == 0 || l.gap > l.maxLine || l.watchGapBps > BPS || l.maxPriceGapBps > 5_000) {
            revert InvalidLimits();
        }
        limits = l;
        emit LimitsSet(l.maxLine, l.gap, l.watchGapBps, l.maxPriceGapBps);
    }

    function _setThresholds(Thresholds memory t) internal {
        if (t.twapWatchBps == 0 || t.twapProtectBps <= t.twapWatchBps || t.twapProtectBps > BPS) {
            revert InvalidThresholds();
        }
        if (t.velocityWatchBpsPerHour == 0 || t.velocityProtectBpsPerHour <= t.velocityWatchBpsPerHour) {
            revert InvalidThresholds();
        }
        if (t.sourceDivergenceBps == 0 || t.sourceDivergenceBps > 5_000) revert InvalidThresholds();
        if (t.recoveryDelay > 7 days) revert InvalidThresholds();
        thresholds = t;
        emit ThresholdsSet(t);
    }

    function _setEpochConfig(EpochConfig memory e) internal {
        if (e.duration < 1 hours || e.duration > 30 days || e.growthCap == 0) revert InvalidEpochConfig();
        epochConfig = e;
        emit EpochConfigSet(e.duration, e.growthCap);
    }
}
