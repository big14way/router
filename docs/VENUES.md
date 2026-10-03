# Venues

Live state checked 2 Oct 2026. Every adapter re-reads the flags at quote time; nothing below is assumed at runtime.

| Venue | Quote method | Execute method | Environment | Status 2 Oct 2026 |
|---|---|---|---|---|
| SaucerSwap V1 | `Factory.getPair` for `[in,out]` and `[in,WHBAR,out]`, then `RouterV3.getAmountsOut` via `eth_call` | `RouterExecutor` leg `venue=0`: `swapExactTokensForTokens` or `swapExactETHForTokens{value}` | testnet 0.0.19264, mainnet 0.0.3045981 | live on both |
| SaucerSwap V2 | `Factory.getPool(a,b,fee)` on 500/1500/3000/10000, direct + two-hop via WHBAR, `QuoterV2.quoteExactInput(path, amountIn)` (returns `gasEstimate`) | `RouterExecutor` leg `venue=1`: `SwapRouter.exactInput`, `refundETH` after HBAR legs | testnet 0.0.1414040 / quoter 0.0.1390002, mainnet 0.0.3949434 / 0.0.3949424 | live; mainnet quoter via fallback relay (D-4) |
| SaucerSwap V3 order book | `GET /books` cached 60 s → match pair either direction → require `status=OPEN` and `isMarketHalted=0` → `GET /books/:id/quote/exact-input?inputToken=<evm>&inputAmount=<raw>`; `amountOut = expectedOutputAmount − takerFeePips`; `minNotional` in quote units; grid snap reported | `execute/v3.ts`: onboarding check on chain → fresh quote → `POST /orders/build` with `snappedInputAmount` + `suggestedOutputAmount`, `isAMMEnabled:true` → sign the returned struct (EIP-712, `0x00` bot; `0x01` payload prepared) → `POST /orders/save` → `/ws/user-events` or history → settlement ids | testnet `testnet-orderbook-api.saucerswap.finance`, mainnet `orderbook-api.saucerswap.finance` | testnet: 7 books, only book 3 SAUCE/USDC OPEN but halted; mainnet: books 1 HBAR/USDC, 2 SAUCE/USDC, 3 WBTC/USDC, 4 WETH/USDC, 5 USDT0/USDC OPEN, AMM-enabled, minNotional 15 USDC, taker 1200 pips (USDT0 600) |
| Lambdaplex | `GET /api/v1/exchangeInfo` (TRADING, LOT_SIZE, MIN_NOTIONAL) + `GET /api/v1/depth` walked level by level; `GET /api/v1/order/fee-quote` (Signature V1) when keyed, else taker fee estimated at 25 bps (reference connector default) and labelled | Signature V1 `POST /api/v1/order` (keyed, mainnet only) — not enabled in this build | mainnet `api.lambdaplex.io` | 13 symbols TRADING incl. HBAR-USDC, SAUCE-USDC, WETH-USDC, WBTC-USDC; min notional 5 USDC |

## Selection rules (`router/rank.ts`)

1. The venue reports `canExecute().ok` for the pair (book open and not halted, symbol trading, key configured for Lambdaplex).
2. The quote is `fillable` for the whole size and `minNotionalOk`.
3. All quotes compare on net output: AMM output as quoted, V3 `expectedOutputAmount` minus the book's `takerFeePips`, Lambdaplex depth output minus the taker fee.
4. V3 is chosen only when its net output ≥ best AMM × (1 + 5 bps) (SaucerSwap's own rule).
5. Among the remaining quotes the largest output wins; if two or more V1/V2 routes are executable, the splitter tries to beat it.

## Sample output

`yarn sdk:quote --net mainnet --in SAUCE --out USDC --amount 1000` (2 Oct 2026):

```
SAUCER_V1   executable
  path SAUCE → WHBAR → USDC      out 13.286571  [fillable]
  path SAUCE → USDC              out 13.214745  [fillable]
SAUCER_V2   executable
  fees 3000/1500                 out 13.325436  [fillable, gas 166135]
  fees 3000                      out 13.234468  [fillable, gas 93016]
SAUCER_V3   executable
  book 2 SELL                    out 13.244088  [fillable, below minNotional, fee 0.015912]
LAMBDAPLEX  unavailable: quote-only: LAMBDAPLEX_API_KEY / LAMBDAPLEX_ED25519_SEED not configured
  SAUCE-USDC SELL                out 13.289693  [fillable, fee 0.033307]
best single venue: SAUCER_V2 → 13.325436 USDC
```

`yarn sdk:quote --net testnet --in SAUCE --out USDC --amount 10`:

```
SAUCER_V3   unavailable: book 3 is OPEN but market is halted
LAMBDAPLEX  unavailable: Lambdaplex is mainnet-only
```
