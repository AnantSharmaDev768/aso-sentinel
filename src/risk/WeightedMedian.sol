// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

/// @title WeightedMedian — lower weighted median of a small set of prices
/// @notice Returns the smallest price p such that the weights of all prices <= p add up to at least
/// half of the total weight. With equal weights this is the ordinary lower median.
/// Sorts `prices` (and `weights` alongside) IN PLACE; callers pass memory copies they own.
/// Insertion sort: intended for n <= 16 (the verifier's MAX_SIGNERS).
library WeightedMedian {
    error EmptyInput();
    error LengthMismatch();
    error ZeroTotalWeight();

    function compute(uint256[] memory prices, uint256[] memory weights) internal pure returns (uint256) {
        uint256 n = prices.length;
        if (n == 0) revert EmptyInput();
        if (weights.length != n) revert LengthMismatch();

        for (uint256 i = 1; i < n; ++i) {
            uint256 p = prices[i];
            uint256 w = weights[i];
            uint256 j = i;
            while (j > 0 && prices[j - 1] > p) {
                prices[j] = prices[j - 1];
                weights[j] = weights[j - 1];
                --j;
            }
            prices[j] = p;
            weights[j] = w;
        }

        uint256 total;
        for (uint256 i; i < n; ++i) {
            total += weights[i];
        }
        if (total == 0) revert ZeroTotalWeight();

        uint256 acc;
        for (uint256 i; i < n; ++i) {
            acc += weights[i];
            if (acc * 2 >= total) return prices[i];
        }
        return prices[n - 1]; // unreachable: acc == total at the end
    }
}
