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

### Browser swap from `/swap` (3 Oct 2026, recorded for the demo video)

The same TKA → TKB plan executed from the Scaffold-HBAR app with an in-browser burner wallet (deployer key, testnet only): `/swap` planned the split, HIP-719 `associate()` and the ERC-20 approval ran as separate steps, then one `executeSplit` call settled both legs.

| | |
|---|---|
| Plan | `ONCHAIN_SPLIT`, 2 SaucerSwap V1 legs (60 % / 40 %), 1000 TKA → **2026.96536784 TKB** (best single route 1994.870546, +32.094821 TKB, +1.6 %) |
| planHash | `0xb005e4af4ffe91f84c0a39a695752b01b81cc52a6a680062a9d245da8e767cae` |
| Transaction | [`0xe80112401041e996cbab5f073bf8687b7246a762f6136d4a228db119ea628020`](https://hashscan.io/testnet/transaction/0xe80112401041e996cbab5f073bf8687b7246a762f6136d4a228db119ea628020), gas used 1736911, 17 child records (transfers, allowances, pool calls), all `SUCCESS` |
| Mirror | https://testnet.mirrornode.hedera.com/api/v1/contracts/results/0xe80112401041e996cbab5f073bf8687b7246a762f6136d4a228db119ea628020 — `RouteExecuted(0xf334…6039, TKA, TKB, 100000000000, 202696536784, planHash)` |
| Receipt | topic 0.0.10833350 **sequence 5** (chunks 5–6), https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10833350/messages/5 — `/receipts/5` verified ✅ (found, SUCCESS, planHash match, totalOut match) |

## HCS receipts

| | |
|---|---|
| Topic | [0.0.10833350](https://hashscan.io/testnet/topic/0.0.10833350), submit key = operator, memo `hedera-smart-order-router receipts v1` (`yarn topic:create`) |
| Receipt 1 | sequence 1, consensus `1790982912.235773268`, submit tx `0.0.10833326@1790982906.578418854` — https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10833350/messages/1 |
| Verification | `verifyReceipt` (same code behind `/api/receipt` and `/receipts/1`): receipt found ✅ · transaction SUCCESS ✅ · `RouteExecuted.planHash` matches ✅ · `totalOut` 54083577 matches ✅ → **verified** |

## SaucerSwap V3 on testnet: onboarding and the halted book (2–3 Oct 2026)

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

### Place-and-cancel attempt on book 3 (3 Oct 2026, `yarn v3:place-and-cancel --net testnet --book 3 --input base --amount 10000000 --factor 10`)

Bot = the deployer account 0.0.10833326 (ECDSA). Authentication succeeded (challenge → Hedera personal-sign → JWT, `sub` = the EVM address). Every response below is verbatim.

| Step | Result |
|---|---|
| `GET /books` (book 3) | `{"id":"3","pair":"SAUCE/USDC","status":"OPEN","halted":1,"minNotional":"1","tickStep":"0.0000001","sizeStep":"0.00001"}` → `bookStatus` = `book 3 is OPEN but market is halted` |
| `GET /books/3/quote/exact-input?inputToken=0x…120f46&inputAmount=10000000` (JWT) | `{"snappedInputAmount":"10000000","consumedInputAmount":"0","expectedOutputAmount":"0","suggestedOutputAmount":"1","slippageBps":500,"fillable":false}` (empty, halted book) |
| `POST /orders/build` (LIMIT, sell 10 SAUCE for 100 USDC, 10× any price, 1 h deadline, `isAMMEnabled:true`) | **200** — returned struct: `info{reactor 0x5707…088B, swapper 0xf334…6039, nonce "1", deadline, additionalValidationContract 0xd1a45eba17b05cc62b11e2b62b8a00651a79014c, additionalValidationData "0x"}`, `input{0x…120f46, "10000000"}`, `output{0x…1549, "100000000", recipient}`, `makerOnly false, takerOnce false, maxTakerFeePips 2000, maxMakerFeePips 2000`, `meta{isAMMEnabled:true}` |
| sign (mode `0x00`, EIP-712 against the fetched domain) | ok (65-byte ECDSA signature + mode byte) |
| `POST /orders/save` | **400** `{"error":"Orderbook 3 is currently halted and not accepting new orders"}` |
| `GET /orders?orderbookId=3` | `{"orders":[],"total":0,"page":1,"limit":20,"lastUpdateId":0}` |

Earlier builds documented the grid rules on this book: `Order size not a multiple of market lot size` for 1 SAUCE / 0.1 SAUCE sells (10 SAUCE and 1000 SAUCE pass) and `price 1000000/1000050000 is not a multiple of tick step 1/10000000` for an off-tick price. `GET /fees/3?side=taker` → `{"takerFeePips":2000}`; `side=maker` → `{"makerFeePips":2000,"capFractionPips":250000}`.

### Onboarding attempt (`yarn v3:onboard --net testnet --book 3`)

`GET /onboarding/3/status` (JWT) before: `{"steps":{"associateBaseToken":true,"associateQuoteToken":false,"approveBaseTokenPermit2":false,"approveQuoteTokenPermit2":false,"approveBaseTokenReactor":false,"approveQuoteTokenReactor":false},"pendingSteps":[…],"completedSteps":["associateBaseToken"],"isComplete":false}` — identical to what the SDK derived from chain state (mirror association, ERC-20 `allowance`, `permit2.allowance`). Permit2 read from the reactor: `0x2e2C4f4277183F2BC5eb982CD4cD27C1fb01c6Ed` (0.0.8991877).

First `approve(permit2, 2^256-1)` on SAUCE reverted: tx `0xabf165f6…` → `CONTRACT_EXECUTION_EXCEPTION / INVALID_OPERATION` (HTS allowances are int64; the SDK now approves `2^63-1`). Results after the fix: see below.

Onboarding transactions (all `SUCCESS`, re-verified on chain after each; approvals capped at the token `max_supply`, DEVIATIONS D-10):

| Step | Transaction |
|---|---|
| approveBaseTokenPermit2 (SAUCE → Permit2) | [`0xab9ff949…`](https://hashscan.io/testnet/transaction/0xab9ff94924866b050ce769da11ea85c7747393641390d659d130e7a160d51d8e) |
| approveBaseTokenReactor (`permit2.approve(SAUCE, reactor, max, maxExpiry)`) | [`0x9c24f07f…`](https://hashscan.io/testnet/transaction/0x9c24f07ff8385f9c3ee2a81845b65bc02ef2cb4fcc6324a006e1d4bce6a28a85) |
| associateQuoteToken (HIP-719 `associate()` on USDC) | [`0x2e3cfa2e…`](https://hashscan.io/testnet/transaction/0x2e3cfa2e017b0f2a1b4d45f7c8d44e254ee1731134060975ca9aa0bdd525ec2b) |
| approveQuoteTokenPermit2 (USDC → Permit2) | [`0x77ca5bf0…`](https://hashscan.io/testnet/transaction/0x77ca5bf04dca68f8f7a6e4eb69137d0a650430c92fb4dacd5f9cfc71682c21d7) |
| approveQuoteTokenReactor | [`0xab029546…`](https://hashscan.io/testnet/transaction/0xab0295461cbf71c136a5dc7f4c7e2cadcf96d9bae589641a51bd9e46cb79bd86) |

After: chain = all six steps true; `GET /onboarding/3/status` → `{"isComplete":true,"pendingSteps":[]}`. Failed earlier attempts are also on HashScan: `0xabf165f6…`/`0x494e8ccd…` (`INVALID_OPERATION`, approval above int64) and `0xb3b809c2…`/`0x5c5e178e…` (HTS code 289 `AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY`, approval above max supply).

Place-and-cancel rerun on the fully onboarded account: build 200, signature ok, `POST /orders/save` → `400 {"error":"Orderbook 3 is currently halted and not accepting new orders"}`. The halt is the only thing between this account and a resting order on testnet; the same code path is what `/api/v3/execute` and the `/swap` page run.


## SaucerSwap V3 executed on testnet (3 Oct 2026, book 3 reopened)

Later on 3 Oct testnet book 3 (SAUCE/USDC) came back `OPEN`, `isMarketHalted:0`, with live depth (16 asks, 24 bids) and other bots trading. The same code then ran the full V3 path for real.

| Proof | Command | Result |
|---|---|---|
| Resting limit, then cancel | `yarn v3:place-and-cancel --net testnet --book 3 --input base --amount 10000000 --factor 10` | order **3539170** (sell 10 SAUCE at 10× market) saved `ACTIVE`, `POST /cancel` → `{"status":"PENDING","accepted":[3539170]}`, `ORDER_CANCELED` received on `/ws/user-events` (`reason:"USER"`), history `CREATED → CANCELED` |
| Market order through `execute/v3.ts` | `yarn v3:market --net testnet --book 3 --side SELL --amount 10000000` | order **3539319** `FILLED` 1.2 s after save; settlement [`0x0741ce80…`](https://hashscan.io/testnet/transaction/0x0741ce80c5f12f79cd894a9118a8f1a1c425477d232d6fa60b63de066bc9a327) |
| Market order + HCS receipt | `yarn v3:market --net testnet --book 3 --side SELL --amount 10000000 --receipt` | order **3539436** `FILLED`: 10 SAUCE in, **0.426829 USDC** out (history `fill.outputAmount`), settlement [`0xc5497d6f…`](https://hashscan.io/testnet/transaction/0xc5497d6fdc4f0a382cadf9aea3809be7716878851c275f23aa8a80c13138800a) = Hedera transaction `0.0.6628041@1791023444.071856368`; receipt **sequence 4** on topic 0.0.10833350 |

Receipt 4 verification (`/receipts/4`, same code as `/api/receipt`): receipt found ✅ · EVM settlement exists and succeeded ✅ · its logs move funds of `0xf334…6039` ✅ · Hedera transaction exists and succeeded ✅ · child records involve 0.0.10833326 ✅ · **0.0.10833326 received 426829 of 0.0.5449** ✅ → verified. Mirror: https://testnet.mirrornode.hedera.com/api/v1/transactions/0.0.6628041-1791023444-071856368 (nonce 4: +426829 USDC to the trader; nonce 5: −9.98 SAUCE to the counterparty; nonce 6: −0.04 SAUCE taker fee to the reactor 0.0.9860931).

The router itself does not choose V3 on testnet today: the testnet AMM pools price SAUCE/USDC differently from the book, so V2 pays more and V3 fails the 5 bps rule (`excluded: V3 output not ≥ best AMM + 5 bps`). The market orders above call the V3 executor directly on a `V3_MARKET` plan built from the V3 adapter's quote, exactly what `/swap` runs when V3 wins.

Running against the live API also corrected three assumptions, now covered by tests: history events are `CREATED/FILLED/CANCELED` while the stream sends `ORDER_*`; listed orders carry `id` at the top level; the executed amounts come from the history `fill` object (the stream's `executedPrice` is the order's limit price). Fills consume the standing Permit2 allowance, so onboarding now checks the allowance against the next order's size, not the original cap.

### Demo pool rebalance before the video

The two-leg split above moved the seeded TKA/TKB direct pair from 1 TKA = 2.2 TKB to 1.977. Before recording, one plain V1 swap (sell 1148.82 TKB into the direct pair, tx [`0xd1b9cc7f…`](https://hashscan.io/testnet/transaction/0xd1b9cc7fcd97c420fb20bb324d07fae6f6688cd54c3597da7be27b2fcf7e2acb)) restored the seeded 2.2 price so the on-camera plan shows the effect the demo pools were built for.
