// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Installed at 0x167 with `hardhat_setCode`. Returns 22 on first association, 23 afterwards,
/// or a forced failure code when `setFailCode` is used.
contract MockHTS {
    int64 public failCode;
    mapping(address => mapping(address => bool)) public isAssociated;
    uint256 public calls;

    function setFailCode(int64 code) external {
        failCode = code;
    }

    function associateToken(address account, address token) external returns (int64) {
        calls += 1;
        if (failCode != 0) return failCode;
        if (isAssociated[account][token]) return 23;
        isAssociated[account][token] = true;
        return 22;
    }
}
