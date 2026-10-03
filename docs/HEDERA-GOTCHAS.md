# Hedera gotchas this template handles

Everything here is encoded in `packages/router-sdk/src/units.ts`, `RouterExecutor.sol` or the adapters, and tested. Verified against live docs and the network on 2 Oct 2026.

## HBAR units: 8 decimals in the EVM, 18 at the JSON-RPC relay

- Natively and inside Solidity, HBAR has 8 decimals (tinybar). `msg.value` inside a contract is tinybar.
- The JSON-RPC relay (Hashio) speaks weibar (18 decimals) for `value`, `gasPrice` and `eth_getBalance`. 1 tinybar = 10^10 weibar (HIP-410).
- Empirical check: account 0.0.19264 showed 5 500 000 000 tinybar on the mirror node and 55 × 10^18 weibar on Hashio.
- Rule: anything that goes into an EVM transaction `value` is `tinybarToWeibar(tinybar)`. Anything that comes back from the relay as a balance is `weibarToTinybar`. Function *arguments* (amounts for WHBAR, token amounts) stay in 8 / token decimals.
- Gas price from `eth_gasPrice` on testnet was 890 000 000 000 weibar (890 gwei equivalent).

## Token amounts

All token amounts are integers in the token's smallest unit. WHBAR has 8 decimals, SAUCE and USDC 6. `parseUnits` rejects more fractional digits than the token allows rather than rounding.

## Addresses

HTS tokens and most contracts have long-zero EVM addresses: `0.0.n` ↔ `0x000…n` in hex. Some mainnet tokens (WETH, WBTC on the V3 books) have alias addresses; `addressToEntity` throws on those and the adapters use the ID the API provides instead.

## Association

An account or contract must be associated with an HTS token before it can receive it. Contracts call the HTS system contract at `0x167` `associateToken(address(this), token)`; response 22 = SUCCESS, 23 = TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT, both are fine. Users call `associate()` on the token's own EVM address (HIP-719 facade).

## WHBAR

Never call the WHBAR contract directly and never grant it an allowance (SaucerSwap security advisory). Wrap with `WhbarHelper.deposit()` (payable) and unwrap with `WhbarHelper.unwrapWhbar(uint256 wad)` after approving the helper. In AMM paths HBAR is represented by the WHBAR *token* address.

## Gas: HTS system-contract calls are expensive

Every call into the HTS system contract (association, `transferFrom`, `approve`, the router's own token transfers) costs about 700 000 gas, and creating a token costs about 1.4 M. Measured on testnet (3 Oct 2026): `RouterExecutor.executeSplit` with two V1 legs plus two first-time self-associations used 3295835 gas; a V1 `addLiquidityNewPool` (new pair + two associations + LP token creation) ran out of gas at 6 M and succeeded at 12 M. The SDK sizes `executeSplit` at 2.5 M + 3 M per leg (capped at the 15 M per-transaction limit); unused gas is refunded. The relay pre-charges `gas × gasPrice`, so the sending account needs that balance up front (8.5 M gas ≈ 7.6 HBAR at 890 gwei-equivalent).

## Gas and throttling

No minimum gas charge any more (HIP-1249): actual gas used is billed, the rest refunded. Per-transaction cap is 15M gas. Hashio and the mirror node are rate limited; the SDK retries once with backoff and caches quotes for a few seconds.

## Testnet prices are not real

Testnet pools are thin and priced arbitrarily (observed around 20× off). The UI labels testnet quotes "demo liquidity".
