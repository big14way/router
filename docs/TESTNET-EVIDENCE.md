# Testnet evidence

Network: Hedera testnet (chain 296). Links are HashScan and mirror node (`https://testnet.mirrornode.hedera.com/api/v1/...`).

## Accounts

| Role | EVM address | Account ID | Notes |
|---|---|---|---|
| Deployer / operator | `0xf334EBBF2A14108C324E22aEc7b421A87Aae6039` | _pending funding_ | generated locally (`DEPLOYER_PRIVATE_KEY` in the untracked `.env`); auto-created on first faucet transfer |

## RouterExecutor

_pending: deployed address, HashScan link, Sourcify verification._

## Seeded demo liquidity (`yarn seed:testnet`)

_pending: TKA / TKB token IDs, V1 pair, V2 pool, transaction IDs._

## Split swap (bounty testnet-transaction proof)

_pending: `executeSplit` transaction hash, HashScan link, mirror `/api/v1/contracts/results/<hash>` showing `RouteExecuted` with `planHash`._

## HCS receipts

_pending: topic ID, receipt message sequence number, `/api/v1/topics/<id>/messages/<seq>`, `/receipts/<seq>` verification result._

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
