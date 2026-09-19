// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

/// @title CostModel — rough manipulation-cost vs extractable-value proxy
/// @notice A transparent, deterministic RISK PROXY. It is not a proof of economic security and it does
/// not know real market depth: `depthUsdPer1Pct` is an assumption supplied by governance.
///
/// Model (all values in wad = 1e18 USD / rwaUSD):
///   Attack = inflate the collateral price by a fraction d, post collateral, borrow, walk away.
///   capital(d)     = depthUsdPer1Pct * (d in %)                  capital needed to move the price by d (linear depth)
///   cost(d)        = capital(d) * d * lossShare                   irrecoverable loss on the round trip (assumption)
///   extractable(d) = H * max(0, 1 - mat / (1 + d))                borrowed minus the TRUE value of the posted collateral,
///                                                                 when the attacker borrows the full headroom H
///   Profit needs 1 + d > mat, so the minimum profitable inflation is d0 = mat - 1 (40% at mat = 140%).
///   The attack is evaluated at d0 + 5, 15, 30 and 60 percentage points; the most attractive point
///   (lowest cost / extractable ratio) decides the concern level.
library CostModel {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant RAY = 1e27;

    enum Concern {
        LOW,
        ELEVATED,
        HIGH,
        INSUFFICIENT_DATA
    }

    struct Params {
        uint256 depthUsdPer1Pct; // [wad] capital that moves the price by 1% (assumption; 0 = unknown)
        uint256 headroomUsd; // [wad] new debt the attacker could take (H)
        uint256 matRay; // [ray] liquidation ratio, e.g. 1.4e27
        uint256 lossShareBps; // share of (capital * move) lost on the round trip
        uint256 elevatedRatioBps; // cost/extractable below this => ELEVATED (e.g. 30000 = 3x)
        uint256 highRatioBps; // cost/extractable below this => HIGH (e.g. 10000 = 1x)
    }

    struct Quote {
        uint256 deviationBps; // d
        uint256 capitalUsd;
        uint256 costUsd;
        uint256 extractableUsd;
        uint256 ratioBps; // cost / extractable, type(uint256).max when extractable == 0
    }

    function minProfitableDeviationBps(uint256 matRay) internal pure returns (uint256) {
        return matRay > RAY ? (matRay - RAY) * BPS / RAY : 0;
    }

    function quoteAt(Params memory p, uint256 deviationBps) internal pure returns (Quote memory q) {
        q.deviationBps = deviationBps;
        q.capitalUsd = p.depthUsdPer1Pct * deviationBps / 100;
        q.costUsd = q.capitalUsd * deviationBps * p.lossShareBps / (BPS * BPS);
        uint256 onePlusDRay = (BPS + deviationBps) * RAY / BPS;
        if (onePlusDRay > p.matRay) {
            q.extractableUsd = p.headroomUsd * (onePlusDRay - p.matRay) / onePlusDRay;
        }
        q.ratioBps = q.extractableUsd == 0 ? type(uint256).max : q.costUsd * BPS / q.extractableUsd;
    }

    /// @return concern classification, and the most attractive evaluated attack
    function assess(Params memory p) internal pure returns (Concern concern, Quote memory best) {
        if (p.depthUsdPer1Pct == 0) return (Concern.INSUFFICIENT_DATA, best);
        uint256 d0 = minProfitableDeviationBps(p.matRay);
        best.ratioBps = type(uint256).max;
        uint256[4] memory offsets = [uint256(500), 1_500, 3_000, 6_000];
        for (uint256 i; i < 4; ++i) {
            Quote memory q = quoteAt(p, d0 + offsets[i]);
            if (i == 0 || q.ratioBps < best.ratioBps) best = q;
        }
        if (best.extractableUsd == 0 || best.ratioBps >= p.elevatedRatioBps) return (Concern.LOW, best);
        if (best.ratioBps >= p.highRatioBps) return (Concern.ELEVATED, best);
        return (Concern.HIGH, best);
    }
}
