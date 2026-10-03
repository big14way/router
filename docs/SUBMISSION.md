# Submission packet — Hedera Smart Order Router

| Item | Value |
|---|---|
| Repository (public, MIT) | https://github.com/big14way/router |
| Scaffold command | `npm create scaffold-hbar@latest my-router -- --template big14way/router --frontend nextjs-app --solidity-framework hardhat --network testnet --package-manager yarn` |
| Hedera services used | Smart contracts (`RouterExecutor`, Sourcify-verified), HTS (association, allowances, HTS-backed swaps, seeded demo tokens), HCS (best-execution receipts topic), mirror node (quotes fallback, receipt verification), JSON-RPC relay |
| Testnet transaction proof (HashScan) | https://hashscan.io/testnet/transaction/0xc6cfced426febf4c8787534025757f82b1a581336360d7cc4bc4741412bdb207 (two-leg split, 1000 TKA → 2034.28 TKB) |
| Mirror node proof | https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xc6cfced426febf4c8787534025757f82b1a581336360d7cc4bc4741412bdb207 |
| HCS receipt | https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10833350/messages/2 (topic https://hashscan.io/testnet/topic/0.0.10833350) |
| RouterExecutor | https://hashscan.io/testnet/contract/0x4d0049980a29A6C583163883D102F13AB6C74274 (0.0.10833336) |
| Browser swap from `/swap` | https://hashscan.io/testnet/transaction/0xe80112401041e996cbab5f073bf8687b7246a762f6136d4a228db119ea628020 (two-leg split, 1000 TKA → 2026.97 TKB, burner wallet in the app), receipt sequence 5 verified at `/receipts/5` |
| Second proof (single leg, HBAR in) | https://hashscan.io/testnet/transaction/0xe9f81b5e98fa4e56e7df317f5106a96d63e52bc00fe4dace37b62703d11dc519, receipt sequence 1 |
| V3 order book, executed | Market order 3539436 filled on testnet book 3: https://hashscan.io/testnet/transaction/0xc5497d6fdc4f0a382cadf9aea3809be7716878851c275f23aa8a80c13138800a, receipt sequence 4 verified to the amount received (`docs/TESTNET-EVIDENCE.md`); resting order 3539170 placed and cancelled |
| CI | `.github/workflows/ci.yml` (lint, type checks, coverage, tests, build, scaffold gate, gitleaks) |
| Harness recipe | `.harness/` (spec, PRD, static + command validators, Playwright gate, acceptance contract); `yarn harness:validate` |
| Docs | `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/VENUES.md`, `docs/HEDERA-GOTCHAS.md`, `docs/REFERENCES.md`, `docs/DEVIATIONS.md`, `docs/TESTNET-EVIDENCE.md`, `docs/MAINNET-EVIDENCE.md` |

## Numbers

| Metric | Value |
|---|---|
| SDK unit tests | 103 (vitest), lines ≈ 97 % |
| RouterExecutor tests | 11, statements/lines 100 % |
| Lint | zero warnings across the three workspaces |
| Core routes with no env | `/`, `/swap`, `/orders`, `/receipts/[id]`, `/docs` all 200 (checked by `scripts/gate-check.mjs`) |

## Still to do by the maintainer

- Demo video: recorded and kept outside the repository; attach it in the submission form.
- Dev-ex survey in the submission form.

## Developer-experience notes for the survey

- `create-scaffold-hbar` consumes `template.json` and does not copy it into the project; the gate script checks the source repo instead (D-5).
- Public relays: Hashio/mirror node reject QuoterV2 simulations on mainnet; a fallback relay is needed (D-4). The relay refuses viem's EIP-1559 defaults; transactions need an explicit `gasPrice`.
- HTS costs: every system-contract call is ~700k gas; a new V1 pair needs ~12 M gas; `executeSplit` ~3.3 M for two legs.
- HTS allowances are bounded by int64 and by the token's `max_supply` (code 289) — easy to hit with "unlimited" approvals (D-10).
- The V3 Orderbook API docs omit the EIP-712 order types, the auth signature format and the build body key; all three had to be recovered from the verified reactor source and live probing (REFERENCES, Phase 7).
- Testnet V3 books are mostly closed (book 3 was halted on 2 Oct and reopened on 3 Oct), and V2 pool creation costs 1e16 tinycent on testnet (D-8), which limits what can be demonstrated there.
- The V3 API's history and stream use different event names (`FILLED` vs `ORDER_FILLED`) and different id fields for saved vs listed orders; executed amounts are only in the history `fill` object.
