# Deviations from BUILD.md

Each entry records where live documentation or observed behaviour differed from BUILD.md, and what the template does instead. Dates are when the conflict was observed.

## D-1 (2 Oct 2026) — Gas billing: no 80% minimum charge

**BUILD.md §3** says "Gas: ≥80% of gas limit is charged; set realistic limits."
**Live docs** (https://docs.hedera.com/evm/development/gas-fees.md): "Following HIP-1249, Hedera has ... eliminated minimum gas charges" and "Users are charged only for the actual gas used during transaction execution, with unused gas being fully refunded."
**What we do:** keep realistic gas limits anyway (the 15M per-transaction cap still applies and Hashio rejects oversized limits), but documentation and the UI do not claim an 80% floor.

## D-2 (2 Oct 2026) — `LICENSE` filename

The blank template ships `LICENCE`. BUILD.md §4 and the bounty gate expect `LICENSE`. Renamed, MIT text kept, copyright lines extended.

## D-3 (2 Oct 2026) — Commit attribution

No co-author trailers are added to commits, at the repository owner's request.

## D-4 (2 Oct 2026) — Mainnet QuoterV2 simulation rejected by Hashio / mirror node

**BUILD.md §3** assumes `QuoterV2.quoteExactInput` works "via eth_call" on both networks.
**Observed:** on mainnet, Hashio returns `-32000 Error occurred during transaction simulation: Invalid request` and the mirror node `/api/v1/contracts/call` returns `429 Too Many Requests / Invalid request` for every QuoterV2 call (any pool, any size, any gas, after a 60 s cool-down), while plain view calls such as `getPool` succeed on both. Testnet runs the same call fine. A second public relay (`https://295.rpc.thirdweb.com`) runs the simulation and returns the expected output.
**What we do:** `NetworkConfig.fallbackRpcUrls` lists extra relays; `ethCall` fails over primary → fallbacks → mirror node. Override with `HEDERA_FALLBACK_RPC_URLS` (comma-separated) or replace the primary with `NEXT_PUBLIC_HEDERA_<NET>_RPC_URL`. Production users should run their own relay.
