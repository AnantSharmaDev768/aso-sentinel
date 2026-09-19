// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice MOCK 18-decimal RWA collateral token (stands in for PAXG) for local demos only.
contract MockRWA is ERC20, Ownable {
    constructor(address owner_) ERC20("Mock PAXG (demo only)", "mPAXG") Ownable(owner_) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
