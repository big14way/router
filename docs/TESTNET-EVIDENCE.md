# Testnet evidence

Network: Hedera testnet (chain 296). Links are HashScan and mirror node (`https://testnet.mirrornode.hedera.com/api/v1/...`).

## Accounts

| Role | EVM address | Account ID | Notes |
|---|---|---|---|
| Deployer / operator | `0xf334EBBF2A14108C324E22aEc7b421A87Aae6039` | [0.0.10833326](https://hashscan.io/testnet/account/0.0.10833326) | generated locally (`DEPLOYER_PRIVATE_KEY` in the untracked `.env`); auto-created by the faucet transfer (10 HBAR) on 3 Oct 2026 |

## RouterExecutor

| | |
|---|---|
| Address | `0x4d0049980a29A6C583163883D102F13AB6C74274` = [0.0.10833336](https://hashscan.io/testnet/contract/0x4d0049980a29A6C583163883D102F13AB6C74274) |
| Deploy tx | `0xa4148c8eccc05fd87e62db0d57184ab6c59821275e34f588a28e96718b18920c` (1 485 565 gas) |
| Constructor | V1 RouterV3 0.0.19264, V2 SwapRouter 0.0.1414040, WHBAR token 0.0.15058, WhbarHelper 0.0.5286055 |
| Verification | Sourcify v2 `exact_match` (`yarn hardhat:verify -- RouterExecutor testnet`), shown as verified on HashScan |
| Mirror | https://testnet.mirrornode.hedera.com/api/v1/contracts/0.0.10833336 |

## Seeded demo liquidity (`yarn seed:testnet`, 3 Oct 2026)

| | |
|---|---|
| TKA | [0.0.10839016](https://hashscan.io/testnet/token/0.0.10839016) (8 decimals) |
| TKB | [0.0.10839017](https://hashscan.io/testnet/token/0.0.10839017) (8 decimals) |
| V1 pair TKA/TKB | [0.0.10839033](https://hashscan.io/testnet/contract/0.0.10839033) `0xa1bB1719…7DC0`, reserves 10 000 TKA / 22 000 TKB (1 TKA = 2.2 TKB, shallow) |
| V1 pair TKA/WHBAR | [0.0.10839035](https://hashscan.io/testnet/contract/0.0.10839035) `0x02965202…1e01`, 200 000 TKA / 10.4 WHBAR |
| V1 pair WHBAR/TKB | [0.0.10839037](https://hashscan.io/testnet/contract/0.0.10839037) `0x786753fF…4114`, 400 000 TKB / 10.4 WHBAR (1 TKA = 2.0 TKB via WHBAR, deeper) |
| Pool-creation txs | `0.0.10833326@1791014577.057844458`, `@1791014581.223861874`, `@1791014585.216879151` (each paid the live `pairCreateFee` of 2 USD ≈ 19.8 HBAR; needed 12 M gas, see gotchas) |
| V2 pool | not created: testnet `poolCreateFee()` = 1e16 tinycent (DEVIATIONS D-8) |
| Env | `NEXT_PUBLIC_EXTRA_TOKENS=TKA:0.0.10839016:8,TKB:0.0.10839017:8` |

`yarn sdk:plan --net testnet --in TKA --out TKB --amount 1000 --step 5`:

```
SAUCER_V1   executable
  path TKA → TKB                 out 1994.54396653  [fillable]
  path TKA → WHBAR → TKB         out 1968.42207636  [fillable]
plan ONCHAIN_SPLIT: 2034.27555539 TKB (min 2024.10417762 @ 50 bps)
  best single SAUCER_V1 1994.54396653, split gains +39.73158886
  leg V1 55%: 550 → 1143.65753885
  leg V1 45%: 450 → 890.61801654
```

## Routed swap through RouterExecutor (bounty testnet-transaction proof)

Run with `yarn execute:plan --net testnet --in HBAR --out SAUCE --amount 1` on 3 Oct 2026. The router quoted V1 and V2, V1 won (V2's price on testnet is 25 % worse and no split beat it), and the plan executed through `RouterExecutor.executeSplit` with HBAR as `msg.value`.

| | |
|---|---|
| Plan | `ONCHAIN_SPLIT`, 1 leg (SaucerSwap V1 `WHBAR → SAUCE`), 1 HBAR → 54.083577 SAUCE, `totalMinOut` 53.813160 (50 bps) |
| planHash | `0x08436db04acf51df37aa2e914e3ca5ba404b80732663fc6a0355b88754a94013` |
| Pre-flight | HIP-719 `associate()` on SAUCE from the deployer account (one transaction) |
| Transaction | [`0xe9f81b5e98fa4e56e7df317f5106a96d63e52bc00fe4dace37b62703d11dc519`](https://hashscan.io/testnet/transaction/0xe9f81b5e98fa4e56e7df317f5106a96d63e52bc00fe4dace37b62703d11dc519) |
| Mirror | https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xe9f81b5e98fa4e56e7df317f5106a96d63e52bc00fe4dace37b62703d11dc519 — `result: SUCCESS`, `RouteExecuted(sender, WHBAR, SAUCE, 100000000, 54083577, planHash)` |

### Two-leg split (3 Oct 2026)

`yarn execute:plan --net testnet --in TKA --out TKB --amount 1000 --step 5` executed the plan above atomically: 55 % through the direct TKA/TKB pair and 45 % through TKA → WHBAR → TKB.

| | |
|---|---|
| Plan | `ONCHAIN_SPLIT`, 2 legs, 1000 TKA → **2034.27555539 TKB** (best single route 1994.54396653, +1.99 %), `totalMinOut` 2024.10417762 |
| planHash | `0xd97ea041210e9f7fdbd4138ac8d66593ef742207a39409768da49b13435e91af` |
| Transaction | [`0xc6cfced426febf4c8787534025757f82b1a581336360d7cc4bc4741412bdb207`](https://hashscan.io/testnet/transaction/0xc6cfced426febf4c8787534025757f82b1a581336360d7cc4bc4741412bdb207), gas used 3295835 |
| Mirror | https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xc6cfced426febf4c8787534025757f82b1a581336360d7cc4bc4741412bdb207 — `RouteExecuted(…, 100000000000, 203427555539, planHash)` |
| Receipt | topic 0.0.10833350 **sequence 2**, https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10833350/messages/2 — verified ✅ (found, SUCCESS, planHash match, totalOut match) |

## HCS receipts

| | |
|---|---|
| Topic | [0.0.10833350](https://hashscan.io/testnet/topic/0.0.10833350), submit key = operator, memo `hedera-smart-order-router receipts v1` (`yarn topic:create`) |
| Receipt 1 | sequence 1, consensus `1790982912.235773268`, submit tx `0.0.10833326@1790982906.578418854` — https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10833350/messages/1 |
| Verification | `verifyReceipt` (same code behind `/api/receipt` and `/receipts/1`): receipt found ✅ · transaction SUCCESS ✅ · `RouteExecuted.planHash` matches ✅ · `totalOut` 54083577 matches ✅ → **verified** |

## SaucerSwap V3 on testnet (attempt)

Checked 2 Oct 2026 via `GET https://testnet-orderbook-api.saucerswap.finance/books`:

| id | pair | status | halted |
|---|---|---|---|
| 11 | HBAR(0.0.0)/USDC | CLOSED | 0 |
| 10 | USDC/GRELF | CLOSED | 0 |
| 5 | HBAR(0.0.8647814)/USDC | CLOSED | 0 |
| 4 | USDC/GRELF | CLOSED | 0 |
| 3 | SAUCE/USDC | **OPEN** | **1** |
| 2 | WHBAR(0.0.15058)/USDC | CLOSED | 0 |
| 1 | USDC/SAUCE | CLOSED | 0 |

`GET /books/3/quote/exact-input?inputToken=0x…120f46&inputAmount=10000000` → `{"snappedInputAmount":"10000000","consumedInputAmount":"0","expectedOutputAmount":"0","suggestedOutputAmount":"1","slippageBps":500,"fillable":false}` (empty book). `GET /depth/3` → `asks:[], bids:[]`.

`GET /signature/domain` → `{"name":"PartialFillLimitOrderReactor","version":"1","chainId":296,"verifyingContract":"0x5707B946EE64bD750A587261Ce36ec7024F3088B"}`.

_pending: onboarding + place-and-cancel attempt against book 3 with raw API responses (V3 execution phase)._
