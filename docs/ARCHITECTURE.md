# Architecture

## One sentence

`quoteAll` asks every venue adapter for an executable price, `rankQuotes` applies the venue rules, `splitAcrossAmms` grid-searches a V1/V2 split, `buildPlan` emits an `ExecutionPlan` with a `planHash`, one executor per plan kind runs it, `publishReceipt` writes what happened to HCS, and `verifyReceipt` proves it from the mirror node.

## Data flow

```
tokenIn, tokenOut, amountIn
        │
        ▼
venues/*  ──quoteExactInput──▶  VenueReport[]   (per venue: status {ok, reason}, quotes[], latency)
        │
        ▼
router/rank.ts   executable ∧ fillable ∧ minNotionalOk; V3 only if ≥ best AMM + 5 bps; all-in amountOut
        │
        ▼
router/split.ts  top ≤3 V1/V2 routes, 5 % grid (10 % for three), exact re-quotes, never < best single
        │
        ▼
router/plan.ts   ExecutionPlan {kind, legs | order, totalOut, totalMinOut, planHash, alternatives}
        │
        ├─ ONCHAIN_SPLIT ──▶ RouterExecutor.executeSplit(...)  (atomic; emits RouteExecuted(..., planHash))
        ├─ V3_MARKET ──────▶ v3/orders.ts quote → build → sign (0x00|0x01) → save → user-events
        └─ LAMBDAPLEX_MARKET ▶ lambdaplex/orders.ts (keyed; not enabled in this build)
        │
        ▼
receipts/hcs.ts  Receipt v1 → TopicMessageSubmitTransaction (chunked)
        │
        ▼
receipts/verify.ts  topic messages → find planHash → /contracts/results (RouteExecuted) | /transactions
```

## Why the plan hash is computed twice

`planHash = keccak256(abi.encode(tokenIn, tokenOut, Leg[] legs, totalMinOut))`. The SDK computes it when it builds the plan; `RouterExecutor.planHash` computes the same value from calldata and emits it. A receipt therefore carries a value that an independent reader can recompute from the plan *and* find in the transaction log. For off-chain plans the hash is `keccak256` of the canonical order descriptor JSON; verification then checks the settlement transaction exists and involves the account.

## Units

`units.ts` owns every conversion. HBAR is 8 decimals (tinybar) natively, inside the EVM and in function arguments; the JSON-RPC relay speaks 18-decimal weibar for `value`, `gasPrice` and balances (1 tinybar = 10¹⁰ weibar). Token amounts are `bigint` in smallest units end to end; the browser only formats.

## Where secrets live

Only the Next.js API routes (`packages/nextjs/app/api/*` through `lib/router/server.ts`) and the scripts read `HEDERA_OPERATOR_KEY`, `V3_BOT_PRIVATE_KEY`, `LAMBDAPLEX_*`, `DEPLOYER_PRIVATE_KEY`. The browser imports `@sh/router-sdk/client`, which contains no HTTP adapters and no signing code. `/api/quote/tokens` tells the UI *whether* a key is configured, never the key.

## Failure handling

- A venue that cannot quote becomes a `VenueReport` with a reason; it never fails the request.
- `ethCall` fails over primary relay → fallback relays → mirror `/contracts/call` (public mainnet relays reject QuoterV2 simulations).
- `fetchJson` has a 5 s timeout and one retry on 5xx/429; 4xx is final.
- `splitAcrossAmms` treats a failed re-quote as "that grid point is unavailable" and falls back to the best single route.
- `RouterExecutor` reverts the whole transaction if any leg fails or the summed output is below `totalMinOut`; HBAR refunds from routers go back to the caller.
