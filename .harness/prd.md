# PRD — extend the Hedera Smart Order Router

The router already quotes SaucerSwap V1, V2, the V3 order book and Lambdaplex, splits across V1/V2,
executes through `RouterExecutor` (on-chain) or the V3 signed-order flow, publishes an HCS receipt
and verifies it from the mirror node. Read `AGENTS.md` first; it explains the layout, the commands
and the rules (units through `units.ts`, associate before transfer, fetch the V3 domain at runtime,
secrets server-only, mainnet behind `ALLOW_MAINNET_EXECUTION`).

## The feature

Add one more venue adapter following `AGENTS.md › How to add a venue`, or improve an existing one,
without breaking any invariant below. Keep the template scaffoldable (`template.json`, `README.md`,
`AGENTS.md`, `LICENSE`, no `.env`), keep lint at zero warnings and keep SDK coverage at or above 90 %.

## Invariants the validators enforce

1. Every venue returns quotes or an explained `unavailable` status; `yarn sdk:quote --net mainnet --in HBAR --out USDC --amount 100` prints all four venues.
2. A plan is never worse than the best single venue (`router/plan.test.ts` property test).
3. `RouterExecutor` reverts when the summed output is below `totalMinOut` (`packages/hardhat/test`).
4. The V3 signer reproduces the reactor's EIP-712 types and the canonical personal-sign text (`v3/signing.test.ts`).
5. A receipt found on the topic verifies against the `RouteExecuted` log (`receipts/receipts.test.ts`).
6. `/`, `/swap`, `/orders`, `/receipts/[id]` and `/docs` render with no env configured.
