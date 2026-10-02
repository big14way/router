# Mainnet evidence

No mainnet funds were used in this submission. `ALLOW_MAINNET_EXECUTION` stayed `false`; nothing below moved money.

## Read-only quotes (2 Oct 2026)

`yarn sdk:quote --net mainnet --in HBAR --out USDC --amount 100`

```
SAUCER_V1   executable   path WHBAR → USDC        out 9.975337   [fillable]
SAUCER_V2   executable   fees 1500                out 10.004465  [fillable, gas 79942]
SAUCER_V3   executable   book 1 SELL              out 9.978012   [fillable, below minNotional, fee 0.011988]
LAMBDAPLEX  quote-only   HBAR-USDC SELL           out 9.873854   [fillable, fee 0.024746 (estimate 25 bps)]
best single venue: SAUCER_V2 → 10.004465 USDC
```

`yarn sdk:plan --net mainnet --in SAUCE --out USDC --amount 5000 --step 10`

```
plan ONCHAIN_SPLIT: 66.79061 USDC (min 66.456657 @ 50 bps)
  best single SAUCER_V2 66.79061
  leg V2 100%: 5000 → 66.79061
excluded LAMBDAPLEX: quote-only
excluded SAUCER_V3: V3 output not ≥ best AMM + 5 bps
```

## V3 order book state

`GET https://orderbook-api.saucerswap.finance/books`: books 1 HBAR/USDC, 2 SAUCE/USDC, 3 WBTC/USDC, 4 WETH/USDC, 5 USDT0/USDC all `OPEN`, `isMarketHalted:0`, `isAMMEnabled:1`, `minNotional` 15000000 (15 USDC).
`GET /signature/domain` → reactor `0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C`, chain 295 (fetched at runtime, never hard-coded).

## Not run

- V3 place-and-cancel on mainnet (needs a funded, onboarded mainnet bot account and the owner's go-ahead).
- V3 market fill on mainnet.
- Lambdaplex smoke with a key / order placement (Lambdaplex execution is out of scope for this build).
