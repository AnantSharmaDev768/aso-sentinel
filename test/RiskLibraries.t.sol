// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WeightedMedian} from "../src/risk/WeightedMedian.sol";
import {CostModel} from "../src/risk/CostModel.sol";

/// @dev External wrappers so library reverts can be asserted with expectRevert.
contract LibHarness {
    function wm(uint256[] memory p, uint256[] memory w) external pure returns (uint256) {
        return WeightedMedian.compute(p, w);
    }

    function quoteAt(CostModel.Params memory p, uint256 d) external pure returns (CostModel.Quote memory) {
        return CostModel.quoteAt(p, d);
    }

    function assess(CostModel.Params memory p) external pure returns (CostModel.Concern, CostModel.Quote memory) {
        return CostModel.assess(p);
    }
}

contract WeightedMedianTest is Test {
    LibHarness h = new LibHarness();

    function _arr(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory x) {
        x = new uint256[](3);
        (x[0], x[1], x[2]) = (a, b, c);
    }

    function test_EqualWeights_IsOrdinaryMedian() public view {
        assertEq(h.wm(_arr(30, 10, 20), _arr(1, 1, 1)), 20);
    }

    function test_EqualWeightsEvenCount_IsLowerMedian() public view {
        uint256[] memory p = new uint256[](4);
        uint256[] memory w = new uint256[](4);
        (p[0], p[1], p[2], p[3]) = (40, 10, 30, 20);
        (w[0], w[1], w[2], w[3]) = (1, 1, 1, 1);
        assertEq(h.wm(p, w), 20);
    }

    function test_HeavyWeightPullsMedian() public view {
        // 10 carries 60% of the weight -> weighted median is 10, plain median would be 20
        assertEq(h.wm(_arr(10, 20, 30), _arr(6, 2, 2)), 10);
        assertEq(h.wm(_arr(10, 20, 30), _arr(2, 2, 6)), 30);
    }

    function test_WeightsFollowTheirPricesWhenSorting() public view {
        // same data as above, unsorted input: the weight of 30 must move with it
        assertEq(h.wm(_arr(30, 10, 20), _arr(6, 2, 2)), 30);
    }

    function test_ExactlyHalfWeightStopsAtThatPrice() public view {
        assertEq(h.wm(_arr(10, 20, 30), _arr(5, 3, 2)), 10); // 5 of 10 = half
    }

    function test_SingleValue() public {
        uint256[] memory p = new uint256[](1);
        uint256[] memory w = new uint256[](1);
        p[0] = 7;
        w[0] = 3;
        assertEq(h.wm(p, w), 7);
    }

    function test_RevertWhen_Empty() public {
        vm.expectRevert(WeightedMedian.EmptyInput.selector);
        h.wm(new uint256[](0), new uint256[](0));
    }

    function test_RevertWhen_LengthMismatch() public {
        vm.expectRevert(WeightedMedian.LengthMismatch.selector);
        h.wm(_arr(1, 2, 3), new uint256[](2));
    }

    function test_RevertWhen_ZeroTotalWeight() public {
        vm.expectRevert(WeightedMedian.ZeroTotalWeight.selector);
        h.wm(_arr(1, 2, 3), _arr(0, 0, 0));
    }

    /// Property: the result is one of the inputs; weight strictly below it < half; weight up to it >= half.
    function testFuzz_WeightedMedianProperty(uint64[5] memory ps, uint16[5] memory ws) public view {
        uint256[] memory p = new uint256[](5);
        uint256[] memory w = new uint256[](5);
        uint256 total;
        for (uint256 i; i < 5; ++i) {
            p[i] = uint256(ps[i]) + 1;
            w[i] = uint256(bound(ws[i], 1, 10_000));
            total += w[i];
        }
        uint256[] memory pc = new uint256[](5);
        uint256[] memory wc = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            (pc[i], wc[i]) = (p[i], w[i]);
        }
        uint256 m = h.wm(pc, wc);
        uint256 below;
        uint256 upTo;
        bool found;
        for (uint256 i; i < 5; ++i) {
            if (p[i] == m) found = true;
            if (p[i] < m) below += w[i];
            if (p[i] <= m) upTo += w[i];
        }
        assertTrue(found, "median is an input");
        assertLt(below * 2, total, "less than half strictly below");
        assertGe(upTo * 2, total, "at least half at or below");
    }
}

contract CostModelTest is Test {
    LibHarness h = new LibHarness();
    uint256 constant RAY = 1e27;

    function _params(uint256 depth, uint256 headroom) internal pure returns (CostModel.Params memory) {
        return CostModel.Params({
            depthUsdPer1Pct: depth,
            headroomUsd: headroom,
            matRay: 1.4e27,
            lossShareBps: 5_000,
            elevatedRatioBps: 30_000,
            highRatioBps: 10_000
        });
    }

    function test_KnownQuote() public view {
        // depth $1,000 per 1%, move 100% (10,000 bps): capital = 1,000 * 100 = $100,000
        // cost = 100,000 * 1.00 * 50% = $50,000; EV = 100,000 * (1 - 1.4/2.0) = $30,000
        CostModel.Quote memory q = h.quoteAt(_params(1_000e18, 100_000e18), 10_000);
        assertEq(q.capitalUsd, 100_000e18);
        assertEq(q.costUsd, 50_000e18);
        assertEq(q.extractableUsd, 30_000e18);
        assertEq(q.ratioBps, 16_666); // 1.67x
    }

    function test_NoExtractableValueBelowLiquidationRatio() public view {
        // a 40% inflation at mat 140% leaves nothing to extract; ratio is "infinite"
        CostModel.Quote memory q = h.quoteAt(_params(1_000e18, 100_000e18), 4_000);
        assertEq(q.extractableUsd, 0);
        assertEq(q.ratioBps, type(uint256).max);
        q = h.quoteAt(_params(1_000e18, 100_000e18), 4_001);
        assertGt(q.extractableUsd, 0);
    }

    function test_ExtractableNeverExceedsHeadroom() public view {
        CostModel.Quote memory q = h.quoteAt(_params(1e18, 100_000e18), 1_000_000); // +10,000%
        assertLt(q.extractableUsd, 100_000e18);
    }

    function test_Classification_Low_Elevated_High_Insufficient() public view {
        (CostModel.Concern c,) = h.assess(_params(250_000e18, 100_000e18));
        assertEq(uint8(c), uint8(CostModel.Concern.LOW), "deep market");
        (c,) = h.assess(_params(1_000e18, 100_000e18));
        assertEq(uint8(c), uint8(CostModel.Concern.ELEVATED), "thin market, bounded headroom");
        (c,) = h.assess(_params(1_000e18, 1_000_000e18));
        assertEq(uint8(c), uint8(CostModel.Concern.HIGH), "thin market, large headroom");
        (c,) = h.assess(_params(0, 1_000_000e18));
        assertEq(uint8(c), uint8(CostModel.Concern.INSUFFICIENT_DATA), "unknown depth");
    }

    function test_ZeroHeadroomIsLowConcern() public view {
        (CostModel.Concern c, CostModel.Quote memory q) = h.assess(_params(1e18, 0));
        assertEq(uint8(c), uint8(CostModel.Concern.LOW));
        assertEq(q.extractableUsd, 0);
    }

    function test_AssessPicksMostAttractiveAttack() public view {
        (, CostModel.Quote memory best) = h.assess(_params(1_000e18, 1_000_000e18));
        CostModel.Params memory p = _params(1_000e18, 1_000_000e18);
        uint256[4] memory ds = [uint256(4_500), 5_500, 7_000, 10_000];
        for (uint256 i; i < 4; ++i) {
            assertLe(best.ratioBps, h.quoteAt(p, ds[i]).ratioBps);
        }
    }

    function testFuzz_CostIncreasesWithDeviation(uint64 depth, uint16 d1, uint16 d2) public view {
        uint256 dep = bound(depth, 1, 1e12) * 1e18;
        uint256 a = bound(d1, 1, 30_000);
        uint256 b = bound(d2, a, 30_000);
        CostModel.Params memory p = _params(dep, 1_000_000e18);
        assertLe(h.quoteAt(p, a).costUsd, h.quoteAt(p, b).costUsd);
        assertLe(h.quoteAt(p, a).extractableUsd, h.quoteAt(p, b).extractableUsd);
    }

    function testFuzz_MoreHeadroomNeverLowersConcern(uint64 depth, uint64 h1, uint64 h2) public view {
        uint256 dep = bound(depth, 1, 1e9) * 1e18;
        uint256 a = bound(h1, 0, 1e12) * 1e18;
        uint256 b = bound(h2, a / 1e18, 1e12) * 1e18;
        (, CostModel.Quote memory qa) = h.assess(_params(dep, a));
        (, CostModel.Quote memory qb) = h.assess(_params(dep, b));
        assertGe(qa.ratioBps, qb.ratioBps, "larger headroom is at least as attractive");
    }
}
