// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ASOVerifier} from "../ASOVerifier.sol";
import {WeightedMedian} from "./WeightedMedian.sol";
import {CostModel} from "./CostModel.sol";

/// @title ASORiskEngine — on-chain market-risk signals built from ASOVerifier's ACCEPTED rounds
/// @notice Adds economic signals on top of the verifier's data-integrity checks:
///   - a price history (ring buffer) fed only by rounds the verifier accepted (`sync`, permissionless),
///   - a time-weighted average price (TWAP) with a coverage requirement,
///   - price velocity between the last two accepted rounds,
///   - a conservative effective price = min(latest attested price, TWAP) when the TWAP is valid,
///   - an optional per-source record with a weighted median, re-verified against the verifier's
///     EIP-712 digest and signer set (`recordSources`, permissionless),
///   - the manipulation-cost proxy (CostModel) using a governance-supplied depth ASSUMPTION.
/// Weights are configured reliability/liquidity weights set by the owner; they are NOT independently
/// measured market liquidity. Nothing here changes any price used by the Vat.
contract ASORiskEngine is Ownable2Step {
    struct Observation {
        uint128 price; // [wad] verifier median of an accepted round
        uint64 timestamp; // verifier.observedAt() of that round
        uint64 nonce; // accepted round nonce
    }

    struct SourceReport {
        uint128 price;
        uint64 validAfter;
        uint64 nonce;
    }

    uint256 public constant CAPACITY = 32;
    uint16 public constant MAX_WEIGHT = 10_000;
    uint256 internal constant BPS = 10_000;

    ASOVerifier public immutable verifier;

    Observation[CAPACITY] internal _obs;
    uint256 public observationCount; // total ever recorded; slot = count % CAPACITY
    uint64 public lastRecordedNonce;

    // TWAP / velocity parameters
    uint32 public twapWindow; // [s]
    uint16 public minCoverageBps; // share of the window the history must cover for the TWAP to be valid
    uint32 public minVelocityInterval; // [s] floor on the interval used for velocity (avoids huge values)

    // Manipulation-cost assumptions
    uint256 public depthUsdPer1Pct; // [wad] 0 = unknown
    uint64 public depthUpdatedAt;
    uint32 public maxDepthAge; // [s] older depth => INSUFFICIENT_DATA
    uint16 public lossShareBps;
    uint32 public elevatedRatioBps;
    uint32 public highRatioBps;

    // Per-source data
    mapping(address => uint16) public sourceWeight;
    mapping(address => SourceReport) public lastReport;
    uint64 public weightedNonce;
    uint256 public weightedMedianPrice;
    uint8 public weightedSourceCount;

    event ObservationRecorded(uint64 indexed nonce, uint256 price, uint64 timestamp);
    event SourcesRecorded(uint64 indexed nonce, uint256 weightedMedian, uint256 sources);
    event SourceWeightSet(address indexed source, uint16 weight);
    event MarketDepthSet(uint256 depthUsdPer1Pct, uint64 updatedAt);
    event TwapParamsSet(uint32 window, uint16 minCoverageBps, uint32 minVelocityInterval);
    event CostParamsSet(uint16 lossShareBps, uint32 elevatedRatioBps, uint32 highRatioBps, uint32 maxDepthAge);

    error InvalidParams();
    error NotAnAuthorisedSource(address source);
    error InvalidWeight(uint16 weight);
    error MissingWeight(address source);
    error NotLatestAcceptedRound(uint64 nonce, uint64 accepted);
    error AlreadyRecorded(uint64 nonce);
    error NoAcceptedRound();
    error BelowQuorum(uint256 provided, uint256 quorum);
    error LengthMismatch();
    error WrongProfile(uint256 index);
    error InvalidSignature(uint256 index);
    error SignersNotStrictlyAscending(uint256 index);

    constructor(
        ASOVerifier verifier_,
        address owner_,
        uint32 twapWindow_,
        uint16 minCoverageBps_,
        uint32 minVelocityInterval_,
        uint32 maxDepthAge_
    ) Ownable(owner_) {
        verifier = verifier_;
        _setTwapParams(twapWindow_, minCoverageBps_, minVelocityInterval_);
        _setCostParams(5_000, 30_000, 10_000, maxDepthAge_);
    }

    // =====================================================================
    // Recording (permissionless)
    // =====================================================================

    /// @notice Record the verifier's latest ACCEPTED round, if it is new. Returns true if recorded.
    function sync() public returns (bool) {
        uint64 accepted = verifier.lastAcceptedNonce();
        if (accepted == 0 || accepted == lastRecordedNonce) return false;
        uint256 p = verifier.price(); // <= uint128 max, enforced by the verifier
        uint64 t = verifier.observedAt(); // non-decreasing across accepted rounds, enforced by the verifier
        _obs[observationCount % CAPACITY] = Observation(uint128(p), t, accepted);
        ++observationCount;
        lastRecordedNonce = accepted;
        emit ObservationRecorded(accepted, p, t);
        return true;
    }

    /// @notice Record the individual source prices of the verifier's latest accepted round and compute
    /// their weighted median. Every signature is re-checked against the verifier's EIP-712 digest and
    /// signer set; at least `quorum` sources are required; one record per round (first wins).
    function recordSources(ASOVerifier.PriceAttestation[] calldata atts, bytes[] calldata sigs) external {
        uint256 n = atts.length;
        if (n != sigs.length) revert LengthMismatch();
        uint256 q = verifier.quorum();
        if (n < q) revert BelowQuorum(n, q);
        uint64 accepted = verifier.lastAcceptedNonce();
        if (accepted == 0) revert NoAcceptedRound();
        if (accepted <= weightedNonce) revert AlreadyRecorded(accepted);

        bytes32 profile = verifier.profileId();
        uint256[] memory prices = new uint256[](n);
        uint256[] memory weights = new uint256[](n);
        address prev;
        for (uint256 i; i < n; ++i) {
            ASOVerifier.PriceAttestation calldata a = atts[i];
            if (a.nonce != accepted) revert NotLatestAcceptedRound(a.nonce, accepted);
            if (a.profileId != profile) revert WrongProfile(i);
            (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(verifier.attestationDigest(a), sigs[i]);
            if (err != ECDSA.RecoverError.NoError || signer != a.source) revert InvalidSignature(i);
            if (!verifier.isSigner(signer)) revert NotAnAuthorisedSource(signer);
            if (signer <= prev) revert SignersNotStrictlyAscending(i);
            prev = signer;
            uint16 w = sourceWeight[signer];
            if (w == 0) revert MissingWeight(signer);
            prices[i] = a.price;
            weights[i] = w;
            lastReport[signer] = SourceReport(uint128(a.price), a.validAfter, accepted);
        }
        uint256 wm = WeightedMedian.compute(prices, weights);
        weightedNonce = accepted;
        weightedMedianPrice = wm;
        weightedSourceCount = uint8(n);
        emit SourcesRecorded(accepted, wm, n);
    }

    // =====================================================================
    // Views
    // =====================================================================

    function storedObservations() public view returns (uint256) {
        return observationCount < CAPACITY ? observationCount : CAPACITY;
    }

    /// @param back 0 = newest, 1 = the one before, ...
    function observation(uint256 back) public view returns (Observation memory) {
        if (back >= storedObservations()) revert InvalidParams();
        return _obs[(observationCount - 1 - back) % CAPACITY];
    }

    /// @notice Time-weighted average of accepted prices over [now - twapWindow, now]. Each price holds from
    /// its round's observation time until the next one (the latest holds until now).
    /// @return value [wad], ok (history covers >= minCoverageBps of the window), coverageBps
    function twap() public view returns (uint256 value, bool ok, uint256 coverageBps) {
        uint256 n = storedObservations();
        if (n == 0) return (0, false, 0);
        uint256 end = block.timestamp;
        uint256 start = end > twapWindow ? end - twapWindow : 0;
        uint256 weighted;
        uint256 covered;
        uint256 segEnd = end;
        for (uint256 k; k < n; ++k) {
            Observation memory o = _obs[(observationCount - 1 - k) % CAPACITY];
            uint256 segStart = o.timestamp > start ? o.timestamp : start;
            if (segEnd > segStart) {
                weighted += uint256(o.price) * (segEnd - segStart);
                covered += segEnd - segStart;
            }
            if (o.timestamp <= start) break;
            segEnd = o.timestamp;
        }
        if (covered == 0) return (0, false, 0);
        value = weighted / covered;
        coverageBps = covered * BPS / twapWindow;
        ok = coverageBps >= minCoverageBps;
    }

    /// @notice Price change between the last two accepted rounds, per hour.
    function velocity() public view returns (uint256 bpsPerHour, bool rising, bool ok) {
        if (storedObservations() < 2) return (0, false, false);
        Observation memory o1 = _obs[(observationCount - 1) % CAPACITY];
        Observation memory o0 = _obs[(observationCount - 2) % CAPACITY];
        if (o0.price == 0 || o1.timestamp < o0.timestamp) return (0, false, false);
        uint256 dt = o1.timestamp - o0.timestamp;
        if (dt < minVelocityInterval) dt = minVelocityInterval;
        rising = o1.price >= o0.price;
        uint256 diff = rising ? o1.price - o0.price : o0.price - o1.price;
        bpsPerHour = diff * BPS * 3600 / (uint256(o0.price) * dt);
        ok = true;
    }

    /// @notice |latest attested price - TWAP| / TWAP.
    function spotDeviation() public view returns (uint256 deviationBps, bool above, bool ok) {
        (uint256 t, bool tOk,) = twap();
        if (!tOk || t == 0) return (0, false, false);
        uint256 spot = verifier.price();
        above = spot >= t;
        deviationBps = (above ? spot - t : t - spot) * BPS / t;
        ok = true;
    }

    /// @notice Conservative effective price = min(latest attested price, TWAP) when the TWAP is valid;
    /// otherwise the latest attested price with twapOk = false (never a fabricated fallback).
    function effectivePrice() public view returns (uint256 price, bool twapOk) {
        uint256 spot = verifier.price();
        (uint256 t, bool tOk,) = twap();
        if (tOk && t < spot) return (t, true);
        return (spot, tOk);
    }

    function depthFresh() public view returns (bool) {
        return depthUsdPer1Pct != 0 && block.timestamp - depthUpdatedAt <= maxDepthAge;
    }

    /// @notice Cost gate with this engine's assumptions for a given headroom and liquidation ratio.
    function costAssessment(uint256 headroomUsd, uint256 matRay)
        external
        view
        returns (CostModel.Concern, CostModel.Quote memory)
    {
        return CostModel.assess(_params(depthFresh() ? depthUsdPer1Pct : 0, headroomUsd, matRay));
    }

    /// @notice What-if quote for the Manipulation Cost Lab: same formulas, caller-supplied inputs.
    function quote(uint256 depthUsd, uint256 headroomUsd, uint256 matRay, uint256 deviationBps)
        external
        view
        returns (CostModel.Quote memory q, CostModel.Concern concern, CostModel.Quote memory best)
    {
        CostModel.Params memory p = _params(depthUsd, headroomUsd, matRay);
        q = CostModel.quoteAt(p, deviationBps);
        (concern, best) = CostModel.assess(p);
    }

    // =====================================================================
    // Administration (bounded)
    // =====================================================================

    function setSourceWeight(address source, uint16 weight) external onlyOwner {
        if (!verifier.isSigner(source)) revert NotAnAuthorisedSource(source);
        if (weight == 0 || weight > MAX_WEIGHT) revert InvalidWeight(weight);
        sourceWeight[source] = weight;
        emit SourceWeightSet(source, weight);
    }

    /// @notice Governance-supplied depth assumption (capital that moves the price by 1%). Not measured.
    function setMarketDepth(uint256 depthUsdPer1Pct_) external onlyOwner {
        if (depthUsdPer1Pct_ == 0 || depthUsdPer1Pct_ > 1e36) revert InvalidParams();
        depthUsdPer1Pct = depthUsdPer1Pct_;
        depthUpdatedAt = uint64(block.timestamp);
        emit MarketDepthSet(depthUsdPer1Pct_, depthUpdatedAt);
    }

    function setTwapParams(uint32 window, uint16 minCoverage, uint32 minVelInterval) external onlyOwner {
        _setTwapParams(window, minCoverage, minVelInterval);
    }

    function setCostParams(uint16 lossShare, uint32 elevatedRatio, uint32 highRatio, uint32 maxDepthAge_)
        external
        onlyOwner
    {
        _setCostParams(lossShare, elevatedRatio, highRatio, maxDepthAge_);
    }

    function _params(uint256 depth, uint256 headroomUsd, uint256 matRay)
        internal
        view
        returns (CostModel.Params memory)
    {
        return CostModel.Params({
            depthUsdPer1Pct: depth,
            headroomUsd: headroomUsd,
            matRay: matRay,
            lossShareBps: lossShareBps,
            elevatedRatioBps: elevatedRatioBps,
            highRatioBps: highRatioBps
        });
    }

    function _setTwapParams(uint32 window, uint16 minCoverage, uint32 minVelInterval) internal {
        if (window < 5 minutes || window > 7 days) revert InvalidParams();
        if (minCoverage == 0 || minCoverage > BPS) revert InvalidParams();
        if (minVelInterval == 0 || minVelInterval > 1 days) revert InvalidParams();
        twapWindow = window;
        minCoverageBps = minCoverage;
        minVelocityInterval = minVelInterval;
        emit TwapParamsSet(window, minCoverage, minVelInterval);
    }

    function _setCostParams(uint16 lossShare, uint32 elevatedRatio, uint32 highRatio, uint32 maxDepthAge_) internal {
        if (lossShare == 0 || lossShare > BPS) revert InvalidParams();
        if (highRatio == 0 || elevatedRatio < highRatio || elevatedRatio > 1_000_000) revert InvalidParams();
        if (maxDepthAge_ < 1 hours || maxDepthAge_ > 90 days) revert InvalidParams();
        lossShareBps = lossShare;
        elevatedRatioBps = elevatedRatio;
        highRatioBps = highRatio;
        maxDepthAge = maxDepthAge_;
        emit CostParamsSet(lossShare, elevatedRatio, highRatio, maxDepthAge_);
    }
}
