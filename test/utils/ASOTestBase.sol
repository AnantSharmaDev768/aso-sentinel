// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SystemDeployer} from "../../script/SystemDeployer.sol";
import {ASOVerifier} from "../../src/ASOVerifier.sol";
import {ASOSentinel} from "../../src/ASOSentinel.sol";

abstract contract ASOTestBase is Test, SystemDeployer {
    uint256 internal constant START = 1_800_000_000; // fixed chain time => deterministic runs
    uint256 internal constant N_SOURCES = 5;

    System internal s;
    Config internal cfg;

    address internal admin = makeAddr("admin");
    address internal feeder = makeAddr("feeder");
    address internal guardian = makeAddr("guardian");
    address internal alice = makeAddr("alice"); // honest borrower
    address internal mallory = makeAddr("mallory"); // attacker

    address[] internal signerAddrs; // ascending
    uint256[] internal signerKeys; // same order as signerAddrs
    uint64 internal nextNonce = 1;

    function setUp() public virtual {
        vm.warp(START);
        cfg = defaultConfig();
        _makeSources();
        s = _deploySystem(cfg, admin, feeder, guardian, signerAddrs);
        s.osm.kiss(address(this)); // lets tests read the OSM directly (test contract is an OSM ward)
        _primeOsm();

        vm.startPrank(admin);
        s.gem.mint(alice, 1_000e18);
        s.gem.mint(mallory, 1_000e18);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ sources / attestations

    function _makeSources() internal {
        for (uint256 i; i < N_SOURCES; ++i) {
            (address a, uint256 k) = makeAddrAndKey(string.concat("source", vm.toString(i)));
            signerAddrs.push(a);
            signerKeys.push(k);
        }
        // sort ascending by address (bubble sort; n = 5)
        for (uint256 i; i < N_SOURCES; ++i) {
            for (uint256 j; j + 1 < N_SOURCES - i; ++j) {
                if (signerAddrs[j] > signerAddrs[j + 1]) {
                    (signerAddrs[j], signerAddrs[j + 1]) = (signerAddrs[j + 1], signerAddrs[j]);
                    (signerKeys[j], signerKeys[j + 1]) = (signerKeys[j + 1], signerKeys[j]);
                }
            }
        }
    }

    function _att(uint256 price, uint64 nonce, address source)
        internal
        view
        returns (ASOVerifier.PriceAttestation memory)
    {
        return ASOVerifier.PriceAttestation({
            profileId: PROFILE_ID,
            price: price,
            validAfter: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            source: source
        });
    }

    function _sign(uint256 key, ASOVerifier.PriceAttestation memory a) internal view returns (bytes memory) {
        return _signFor(s.verifier, key, a);
    }

    function _signFor(ASOVerifier v, uint256 key, ASOVerifier.PriceAttestation memory a)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v_, bytes32 r, bytes32 s_) = vm.sign(key, v.attestationDigest(a));
        return abi.encodePacked(r, s_, v_);
    }

    /// @dev Round signed by the first prices.length sources (ascending), all fresh "now".
    function _round(uint256[] memory prices, uint64 nonce)
        internal
        view
        returns (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs)
    {
        atts = new ASOVerifier.PriceAttestation[](prices.length);
        sigs = new bytes[](prices.length);
        for (uint256 i; i < prices.length; ++i) {
            atts[i] = _att(prices[i], nonce, signerAddrs[i]);
            sigs[i] = _sign(signerKeys[i], atts[i]);
        }
    }

    function _p(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory p) {
        p = new uint256[](3);
        (p[0], p[1], p[2]) = (a, b, c);
    }

    function _p3(uint256 usd) internal pure returns (uint256[] memory) {
        return _p(usd * WAD, usd * WAD, usd * WAD);
    }

    /// @dev Relay a fresh 3-of-5 round at `usd` for every source, using the next nonce.
    function _submitAgreeing(uint256 usd) internal returns (ASOVerifier.Status) {
        return _submit(_p3(usd));
    }

    function _submit(uint256[] memory prices) internal returns (ASOVerifier.Status st) {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(prices, nextNonce++);
        st = s.verifier.submitRound(atts, sigs);
    }

    // ------------------------------------------------------------------ Multipli price path

    /// @dev OSM needs two pokes one hop apart before `cur` holds a value.
    function _primeOsm() internal {
        s.osm.poke();
        vm.warp(block.timestamp + cfg.osmHop);
        s.osm.poke();
        _pokeSpotters();
    }

    function _pokeSpotters() internal {
        s.baseline.spotter.poke(ILK);
        s.protectedStack.spotter.poke(ILK);
    }

    function _setMarketPrice(uint256 usd) internal {
        vm.prank(feeder);
        s.feed.setAnswer(int256(usd * 1e8));
    }

    /// @dev One OSM hop: warp, poke OSM (a no-op if the adapter is stale), poke both Spotters.
    function _advanceOsmHop() internal {
        vm.warp(block.timestamp + cfg.osmHop);
        s.osm.poke();
        _pokeSpotters();
    }

    function _osmPrice() internal view returns (uint256 val, bool has) {
        (bytes32 v, bool h) = s.osm.peek();
        return (uint256(v), h);
    }

    // ------------------------------------------------------------------ Vat helpers

    function _deposit(Stack memory st, address who, uint256 inkWad) internal {
        vm.startPrank(who);
        s.gem.approve(address(st.join), inkWad);
        st.join.join(who, inkWad);
        st.vat.frob(ILK, who, who, who, int256(inkWad), 0);
        vm.stopPrank();
    }

    function _borrow(Stack memory st, address who, uint256 wad) internal {
        vm.prank(who);
        st.vat.frob(ILK, who, who, who, 0, int256(wad));
    }

    function _repay(Stack memory st, address who, uint256 wad) internal {
        vm.prank(who);
        st.vat.frob(ILK, who, who, who, 0, -int256(wad));
    }

    function _line(Stack memory st) internal view returns (uint256 line) {
        (,,, line,) = st.vat.ilks(ILK);
    }

    function _spot(Stack memory st) internal view returns (uint256 spot) {
        (,, spot,,) = st.vat.ilks(ILK);
    }

    function _art(Stack memory st, address who) internal view returns (uint256 art) {
        (, art) = st.vat.urns(ILK, who);
    }

    /// @dev Debt value of `who` at a given USD collateral price, as collateral value / debt [bps].
    function _collateralRatioBps(Stack memory st, address who, uint256 usd) internal view returns (uint256) {
        (uint256 ink, uint256 art) = st.vat.urns(ILK, who);
        if (art == 0) return type(uint256).max;
        return ink * usd * 10_000 / art;
    }
}
