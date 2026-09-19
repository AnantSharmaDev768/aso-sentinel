// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OriginDeployer} from "../../script/OriginDeployer.sol";
import {ASOVerifier} from "../../src/ASOVerifier.sol";
import {OriginSentinel} from "../../src/OriginSentinel.sol";

abstract contract OriginTestBase is Test, OriginDeployer {
    uint256 internal constant START = 1_800_000_000;
    uint256 internal constant N_SOURCES = 5;

    OriginSystem internal o;
    OriginConfig internal oc;

    address internal admin = makeAddr("admin");
    address internal feeder = makeAddr("feeder");
    address internal alice = makeAddr("alice");
    address internal mallory = makeAddr("mallory");

    address[] internal signerAddrs; // ascending
    uint256[] internal signerKeys;
    uint64 internal nextNonce = 1;

    function setUp() public virtual {
        vm.warp(START);
        oc = defaultOriginConfig();
        _makeSources();
        o = _deployOrigin(oc, admin, feeder, signerAddrs);
        vm.startPrank(admin);
        _configureRisk(o, oc, signerAddrs);
        o.gem.mint(alice, 10_000e18);
        o.gem.mint(mallory, 10_000e18);
        vm.stopPrank();
        o.osm.kiss(address(this));
        _primeOsm();
    }

    // ------------------------------------------------------------------ sources

    function _makeSources() internal {
        for (uint256 i; i < N_SOURCES; ++i) {
            (address a, uint256 k) = makeAddrAndKey(string.concat("source", vm.toString(i)));
            signerAddrs.push(a);
            signerKeys.push(k);
        }
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
        (uint8 v, bytes32 r, bytes32 s_) = vm.sign(key, o.verifier.attestationDigest(a));
        return abi.encodePacked(r, s_, v);
    }

    /// @dev Round signed by the first prices.length sources (ascending).
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

    /// @dev Relays a round and, like an honest relayer, records it in the risk engine's history right away
    ///      (`sync` is permissionless; the TWAP is only as complete as the rounds that were synced).
    function _submit(uint256[] memory prices) internal returns (ASOVerifier.Status st) {
        (ASOVerifier.PriceAttestation[] memory atts, bytes[] memory sigs) = _round(prices, nextNonce++);
        st = o.verifier.submitRound(atts, sigs);
        o.riskEngine.sync();
    }

    function _submitAgreeing(uint256 usd) internal returns (ASOVerifier.Status) {
        return _submit(_p3(usd));
    }

    // ------------------------------------------------------------------ Multipli price path

    function _primeOsm() internal {
        o.osm.poke();
        vm.warp(block.timestamp + oc.base.osmHop);
        o.osm.poke();
        _pokeSpotters();
    }

    function _pokeSpotters() internal {
        o.baseline.spotter.poke(ILK);
        o.protectedStack.spotter.poke(ILK);
    }

    function _setMarketPrice(uint256 usd) internal {
        vm.prank(feeder);
        o.feed.setAnswer(int256(usd * 1e8));
    }

    function _advanceOsmHop() internal {
        vm.warp(block.timestamp + oc.base.osmHop);
        o.osm.poke();
        _pokeSpotters();
    }

    // ------------------------------------------------------------------ sentinel

    function _poke() internal returns (OriginSentinel.State) {
        return o.sentinel.poke();
    }

    function _state() internal view returns (OriginSentinel.State) {
        return o.sentinel.state();
    }

    function _assertState(OriginSentinel.State got, OriginSentinel.State want) internal pure {
        assertEq(uint8(got), uint8(want), "state");
    }

    function _hasFlag(uint32 flags, uint32 f) internal pure returns (bool) {
        return flags & f != 0;
    }

    /// @dev From deployment (PROTECTIVE) to FRESH through legitimate steps only:
    ///      history for the TWAP (3 h), a healthy poke (-> RECOVERING), then a new round after the delay.
    function _warmup(uint256 usd) internal {
        _submitAgreeing(usd);
        vm.warp(block.timestamp + 3 hours);
        _submitAgreeing(usd);
        _assertState(_poke(), OriginSentinel.State.RECOVERING);
        vm.warp(block.timestamp + oc.thresholds.recoveryDelay);
        _submitAgreeing(usd);
        _assertState(_poke(), OriginSentinel.State.FRESH);
    }

    // ------------------------------------------------------------------ Vat

    function _deposit(Stack memory st, address who, uint256 inkWad) internal {
        vm.startPrank(who);
        o.gem.approve(address(st.join), inkWad);
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

    function _ilkArt(Stack memory st) internal view returns (uint256 art) {
        (art,,,,) = st.vat.ilks(ILK);
    }
}
