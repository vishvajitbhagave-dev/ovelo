// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice A tiny ERC-20 token with 6 decimals that mimics USDC. It exists
///         ONLY for the escrow tests so the tests move realistic amounts
///         without touching any real or test-net token. Never deployed anywhere.
contract MockUSDC is ERC20 {
    /// Seeds the deployer with 1,000,000.00 Mock USDC for tests to distribute.
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1_000_000 * 10 ** 6);
    }

    /// @notice Test-only helper: gives fresh tokens to any account.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}