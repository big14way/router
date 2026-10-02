// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/// Minimal interface for the Hedera Token Service system contract at 0x167.
/// Only the association calls the router needs; signatures match the official IHederaTokenService.
/// https://docs.hedera.com/evm/hedera-services/system-contracts/hts
interface IHederaTokenService {
    /// Associates `account` with `token`. 22 = SUCCESS, 23 = TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT.
    function associateToken(address account, address token) external returns (int64 responseCode);

    function associateTokens(address account, address[] memory tokens) external returns (int64 responseCode);
}
