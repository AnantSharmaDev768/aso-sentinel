/// join.sol -- Non-standard token adapters

// Copyright (C) 2018 Rain <rainbreak@riseup.net>
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

pragma solidity ^0.6.12;

interface VatLike {
    function slip(bytes32, address, int256) external;
    function move(address, address, uint256) external;
}

interface GemLike5 {
    function decimals() external view returns (uint8);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface DSTokenLike {
    function mint(address, uint256) external;
    function burn(address, uint256) external;
}

contract GemJoin5 {
    // --- Auth ---
    mapping(address => uint256) public wards;

    //Events
    event Rely(address indexed usr);
    event Deny(address indexed usr);
    event Join(address indexed sender, address indexed usr, uint256 wad);
    event Exit(address indexed sender, address indexed usr, uint256 wad);
    event Cage();

    function rely(address usr) external auth {
        wards[usr] = 1;
        emit Rely(usr);
    }

    function deny(address usr) external auth {
        wards[usr] = 0;
        emit Deny(usr);
    }
    modifier auth() {
        require(wards[msg.sender] == 1, "GemJoin5/not-authorized");
        _;
    }

    VatLike public vat;
    bytes32 public ilk;
    GemLike5 public gem;
    uint256 public dec;
    uint256 public live; // Access Flag

    constructor(address vat_, bytes32 ilk_, address gem_) public {
        gem = GemLike5(gem_);
        dec = gem.decimals();
        require(dec <= 18, "GemJoin5/decimals-higher-than-18");
        wards[msg.sender] = 1;
        live = 1;
        vat = VatLike(vat_);
        ilk = ilk_;
    }

    function cage() external auth {
        live = 0;
    }

    function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x, "GemJoin5/overflow");
    }

    function join(address urn, uint256 wad) public {
        require(live == 1, "GemJoin5/not-live");
        uint256 wad18 = mul(wad, 10 ** (18 - dec));
        require(int256(wad18) >= 0, "GemJoin5/overflow");
        vat.slip(ilk, urn, int256(wad18));
        require(gem.transferFrom(msg.sender, address(this), wad), "GemJoin5/failed-transfer");
        emit Join(msg.sender, urn, wad);
    }

    function exit(address guy, uint256 wad) public {
        uint256 wad18 = mul(wad, 10 ** (18 - dec));
        require(int256(wad18) >= 0, "GemJoin5/overflow");
        vat.slip(ilk, msg.sender, -int256(wad18));
        require(gem.transfer(guy, wad), "GemJoin5/failed-transfer");
        emit Exit(msg.sender, guy, wad);
    }
}

contract rwaUSDJoin {
    // --- Auth ---
    mapping(address => uint256) public wards;

    //Events
    event Rely(address indexed usr);
    event Deny(address indexed usr);
    event Join(address indexed sender, address indexed usr, uint256 wad);
    event Exit(address indexed sender, address indexed usr, uint256 wad);
    event Cage();

    function rely(address usr) external auth {
        wards[usr] = 1;
        emit Rely(usr);
    }

    function deny(address usr) external auth {
        wards[usr] = 0;
        emit Deny(usr);
    }
    modifier auth() {
        require(wards[msg.sender] == 1, "rwaUSDJoin/not-authorized");
        _;
    }

    VatLike public vat;
    DSTokenLike public rwaUSD;
    uint256 public live; // Access Flag

    constructor(address vat_, address rwaUSD_) public {
        wards[msg.sender] = 1;
        live = 1;
        vat = VatLike(vat_);
        rwaUSD = DSTokenLike(rwaUSD_);
    }

    function cage() external auth {
        live = 0;
        emit Cage();
    }
    uint256 constant ONE = 10 ** 27;

    function mul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x);
    }

    function join(address usr, uint256 wad) external {
        vat.move(address(this), usr, mul(ONE, wad));
        rwaUSD.burn(msg.sender, wad);
        emit Join(msg.sender, usr, wad);
    }

    function exit(address usr, uint256 wad) external {
        require(live == 1, "rwaUSDJoin/not-live");
        vat.move(msg.sender, address(this), mul(ONE, wad));
        rwaUSD.mint(usr, wad);
        emit Exit(msg.sender, usr, wad);
    }
}
