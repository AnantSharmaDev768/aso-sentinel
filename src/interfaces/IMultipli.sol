// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

/// @notice Minimal interfaces for Multipli's deployed rwaUSD contracts (MakerDAO/dss fork).
/// Signatures are taken from the verified sources vendored in src/multipli/ (see PROVENANCE.md).

interface IVat {
    function wards(address) external view returns (uint256);
    function rely(address usr) external;
    function deny(address usr) external;
    function hope(address usr) external;
    function init(bytes32 ilk) external;
    function file(bytes32 what, uint256 data) external;
    function file(bytes32 ilk, bytes32 what, uint256 data) external;
    function frob(bytes32 i, address u, address v, address w, int256 dink, int256 dart) external;
    function ilks(bytes32 ilk)
        external
        view
        returns (uint256 Art, uint256 rate, uint256 spot, uint256 line, uint256 dust);
    function urns(bytes32 ilk, address urn) external view returns (uint256 ink, uint256 art);
    function gem(bytes32 ilk, address usr) external view returns (uint256);
    function rwaUSD(address usr) external view returns (uint256);
    function debt() external view returns (uint256);
    function Line() external view returns (uint256);
    function live() external view returns (uint256);
}

interface ISpotter {
    function ilks(bytes32 ilk) external view returns (address pip, uint256 mat);
    function par() external view returns (uint256);
    function poke(bytes32 ilk) external;
    function rely(address usr) external;
    function file(bytes32 ilk, bytes32 what, address pip_) external;
    function file(bytes32 what, uint256 data) external;
    function file(bytes32 ilk, bytes32 what, uint256 data) external;
}

interface IOSM {
    function peek() external view returns (bytes32, bool);
    function peep() external view returns (bytes32, bool);
    function poke() external;
    function pass() external view returns (bool);
    function kiss(address a) external;
    function step(uint16 ts) external;
    function hop() external view returns (uint16);
    function zzz() external view returns (uint64);
    function src() external view returns (address);
}

/// @notice Multipli's PriceFeedAdapter ("PIP"): wraps a Chainlink feed, returns (0,false) when stale/invalid.
interface IPriceFeedAdapter {
    function peek() external view returns (bytes32 val, bool has);
    function maxDelay() external view returns (uint256);
}

interface IGemJoin {
    function join(address urn, uint256 wad) external;
    function exit(address guy, uint256 wad) external;
}
