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

## Seeded demo liquidity (`yarn seed:testnet`)

_pending: TKA / TKB token IDs, V1 pair, V2 pool, transaction IDs._

## Routed swap through RouterExecutor (bounty testnet-transaction proof)

Run with `yarn execute:plan --net testnet --in HBAR --out SAUCE --amount 1` on 3 Oct 2026. The router quoted V1 and V2, V1 won (V2's price on testnet is 25 % worse and no split beat it), and the plan executed through `RouterExecutor.executeSplit` with HBAR as `msg.value`.

| | |
|---|---|
| Plan | `ONCHAIN_SPLIT`, 1 leg (SaucerSwap V1 `WHBAR → SAUCE`), 1 HBAR → 54.083577 SAUCE, `totalMinOut` 53.813160 (50 bps) |
| planHash | `0x08436db04acf51df37aa2e914e3ca5ba404b80732663fc6a0355b88754a94013` |
| Pre-flight | HIP-719 `associate()` on SAUCE from the deployer account (one transaction) |
| Transaction | [`0xe9f81b5e98fa4e56e7df317f5106a96d63e52bc00fe4dace37b62703d11dc519`](https://hashscan.io/testnet/transaction/0xe9f81b5e98fa4e56e7df317f5106a96d63e52bc00fe4dace37b62703d11dc519) |
| Mirror | https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xe9f81b5e98fa4e56e7df317f5106a96d63e52bc00fe4dace37b62703d11dc519 — `result: SUCCESS`, `RouteExecuted(sender, WHBAR, SAUCE, 100000000, 54083577, planHash)` |

A multi-leg split (direct vs via-WHBAR on the seeded TKA/TKB pairs) is recorded below once Phase 6 seeding is funded.

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
