// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

/// @notice MOCK Chainlink AggregatorV3-style feed for local demos. A single `feeder` pushes answers;
/// "the feeder stops updating" is simulated simply by not calling setAnswer while time passes.
/// Only the subset of AggregatorV3Interface read by Multipli's PriceFeedAdapter is implemented.
contract MockAggregator {
    uint8 public immutable decimals;
    address public immutable feeder;

    uint80 internal roundId;
    int256 internal answer;
    uint256 internal updatedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    error NotFeeder();

    constructor(uint8 decimals_, address feeder_, int256 initialAnswer) {
        decimals = decimals_;
        feeder = feeder_;
        _set(initialAnswer);
    }

    function setAnswer(int256 answer_) external {
        if (msg.sender != feeder) revert NotFeeder();
        _set(answer_);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }

    function _set(int256 answer_) internal {
        ++roundId;
        answer = answer_;
        updatedAt = block.timestamp;
        emit AnswerUpdated(answer_, roundId, block.timestamp);
    }
}
