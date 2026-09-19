// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

interface PriceFeedAdapterLike {
    function peek() external view returns (bytes32, bool);
}

interface IPriceFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

contract PriceFeedAdapter is PriceFeedAdapterLike {
    uint256 internal constant WAD = 1e18;

    /// @notice Asset this PIP is bound to (for off-chain clarity + config safety)
    address public asset;

    /// @notice On-chain price feed for the asset
    IPriceFeed public priceFeed;

    /// @notice Contract owner
    address public owner;

    /// @notice Paused state
    bool public paused;

    /// @notice Maximum age of a price update before it's considered stale (in seconds)
    uint256 public maxDelay;

    // --- Events ---
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PriceFeedUpdated(address indexed previousFeed, address indexed newFeed);
    event AssetUpdated(address indexed previousAsset, address indexed newAsset);
    event MaxDelayUpdated(uint256 previousDelay, uint256 newDelay);
    event Paused(address account);
    event Unpaused(address account);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    /// @param asset_    Address of the asset token
    /// @param feed_     Address of the Chainlink-compatible price feed
    ///                  (e.g. 3900 for a 1-hour heartbeat feed, with a small buffer)
    constructor(address asset_, address feed_) public {
        require(asset_ != address(0), "INVALID_ASSET");
        require(feed_ != address(0), "INVALID_FEED");

        owner = msg.sender;
        asset = asset_;
        priceFeed = IPriceFeed(feed_);
        maxDelay = 24 hours;
        paused = false;
    }

    // --- Ownership ---
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "INVALID_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // --- Admin setters ---
    function setAsset(address newAsset) external onlyOwner {
        require(newAsset != address(0), "INVALID_ASSET");
        emit AssetUpdated(asset, newAsset);
        asset = newAsset;
    }

    function setPriceFeed(address newFeed) external onlyOwner {
        require(newFeed != address(0), "INVALID_FEED");
        emit PriceFeedUpdated(address(priceFeed), newFeed);
        priceFeed = IPriceFeed(newFeed);
    }

    function setMaxDelay(uint256 newDelay) external onlyOwner {
        require(newDelay > 0, "INVALID_DELAY");
        emit MaxDelayUpdated(maxDelay, newDelay);
        maxDelay = newDelay;
    }

    // --- Emergency ---
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // --- PIP interface ---

    /// @notice Returns (price, true) if the price is valid, or (0, false) if not.
    ///         Never reverts — the OSM's poke() relies on `ok` to skip bad updates.
    function peek() public view virtual override returns (bytes32 val, bool has) {
        if (paused) return (bytes32(0), false);

        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt,) = priceFeed.latestRoundData();

        // Price must be positive
        if (answer <= 0) return (bytes32(0), false);

        // Round must have been started and finalized
        if (startedAt == 0) return (bytes32(0), false);
        if (updatedAt == 0) return (bytes32(0), false);

        // Price must not be older than maxDelay seconds
        if (block.timestamp - updatedAt > maxDelay) return (bytes32(0), false);

        uint8 decimals = priceFeed.decimals();
        uint256 price = (uint256(answer) * WAD) / (10 ** uint256(decimals));

        return (bytes32(price), true);
    }

    function read() external view returns (bytes32 val) {
        bytes32 wut;
        bool haz;
        (wut, haz) = peek();
        require(haz, "Pip/invalid");
        return wut;
    }
}
