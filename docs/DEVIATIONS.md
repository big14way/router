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

## D-5 (2 Oct 2026) — `template.json` is not copied into scaffolded projects

**BUILD.md Phase 12** lists "check `template.json` … exist" among the gate checks. The CLI (`processTemplateManifest` in create-scaffold-hbar 0.4.1) consumes the manifest to generate `.env.example` and the outro and does not copy it into the new project; the blank template behaves the same. **What we do:** the gate checks `template.json` in the *source* repository and `.env.example` in the scaffolded project.

## D-6 (2 Oct 2026) — Blank-template samples removed

`HederaToken.sol`, `HtsTokenCreator.sol`, their deploy scripts, tests and the `.github/workflows/lint.yaml` (which started a forked chain and deployed on every CI run) were removed. `.gitmodules` referenced Foundry submodules that do not exist in the Hardhat flavour and was removed too. BUILD.md §4 only lists `RouterExecutor.sol`, interfaces and mocks under `packages/hardhat/contracts`.

## D-7 (2 Oct 2026) — Lambdaplex execution not built

At the repository owner's instruction Phase 8 (Lambdaplex execution: order placement, fills polling, smoke script with `--place`) was skipped. The adapter quotes Lambdaplex (public depth, keyed fee-quote with Signature V1, unit-tested with a frozen vector); `canExecute` reports the venue as quote-only, keyed or not, so the ranker excludes it and the planner never selects it for execution. There is no `LAMBDAPLEX_MARKET` plan kind; `buildPlan` refuses any off-chain winner other than the V3 book. Phase 7 step 8 (a real mainnet V3 market fill) was also skipped: no mainnet funds were used.

## D-8 (2 Oct 2026) — V2 pool creation on testnet is priced out

`SaucerSwapV2Factory.poolCreateFee()` on testnet returns `10000000000000000` tinycent (≈ 1 000 000 USD, ≈ 10 M HBAR at the live rate); `mintFee()` is 0.05 USD and V1 `pairCreateFee()` is 2 USD. BUILD.md Phase 6 asks for a V1 pair *and* a V2 pool with different prices. **What we do:** `scripts/seed-testnet.ts` reads the live fees, creates the V2 pool only when `poolCreateFee + mintFee` is below `--max-fee-hbar` (default 50 HBAR), and otherwise seeds V1 only with three pairs (TKA/TKB direct, TKA/WHBAR, WHBAR/TKB) so the split runs across the direct V1 route and the via-WHBAR V1 route, as the spec's fallback describes. On mainnet, where the fee is sane, the same script creates the V2 pool.

## D-9 (3 Oct 2026) — V3 wallet signing (mode `0x01`) is prepared, not transported

BUILD.md Phase 7 step 1 asks for the `0x01` wallet path "for HashPack via WalletConnect". The SDK produces everything the reactor verifies for that mode: the canonical order text and the HIP-820 personal-sign bytes (`personalSignPayload`), and the HIP-632 `SignatureMap` wrapper with the mode byte (`signatureMapMode01`). The blank Scaffold-HBAR template ships RainbowKit/wagmi (EVM wallets) and no Hedera-native WalletConnect session, so the app does not open a `hedera_signMessage` request to HashPack. In the app, V3 orders are signed server-side by the bot (`0x00`) when `V3_BOT_*` is configured; wallet users get the on-chain onboarding steps (one-click) and the payload to sign. Adding a Hedera WalletConnect connector is the one missing piece and is documented in AGENTS.md as a follow-up.

## D-10 (3 Oct 2026) — HTS allowance limits for Permit2 approvals

BUILD.md Phase 7 step 3 says "ERC-20 approve to Permit2". On HTS tokens that approval is bounded: `approve(permit2, 2^256-1)` reverts with `INVALID_OPERATION` (allowances are int64) and `approve(permit2, 2^63-1)` reverts with HTS code 289 `AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY` on finite-supply tokens (testnet SAUCE and USDC both have `max_supply` 1e15). The SDK reads the token's supply from the mirror node and approves `min(max_supply, 2^63-1)`; a standing allowance at that cap counts as onboarded.
