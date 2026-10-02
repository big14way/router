# Agent instructions

Briefing for coding agents (Cursor, Claude Code, Codex) working in this Scaffold-HBAR template. Claude Code loads it through `CLAUDE.md`.

This is the Hedera Smart Order Router: quote SaucerSwap V1, V2, the V3 order book and Lambdaplex; split across V1/V2; execute on the best venue; publish an HCS receipt; verify it from the mirror node. Yarn workspaces, Node ≥ 20.18.3, Yarn via Corepack (npm also supported by the CLI).

## Layout

```
packages/router-sdk/src      the router (ESM TypeScript, vitest)
  types.ts units.ts           Token/Quote/ExecutionPlan; the ONLY unit conversions
  config/{testnet,mainnet}    verified addresses + API hosts; tokens.ts resolves symbols/ids
  venues/                     Venue interface + SaucerV1/V2/V3 + Lambdaplex adapters (quote + canExecute)
  router/{rank,split,plan}    ranking rules, grid-search split, ExecutionPlan + planHash
  execute/                    executors per plan kind (on-chain, V3 signed orders, Lambdaplex)
  v3/ lambdaplex/             auth, onboarding, orders, ws, signing for the off-chain venues
  receipts/{hcs,verify}       HCS publish + mirror-node verification
  cli/{quote,plan}            yarn sdk:quote / yarn sdk:plan
packages/hardhat             RouterExecutor.sol, interfaces/, mocks/, test/, deploy/
packages/nextjs              App Router pages + API routes (server-side router calls)
scripts/                     gate-check.mjs, create-topic.ts, seed-testnet.ts, v3-*.ts
docs/                        ARCHITECTURE, VENUES, HEDERA-GOTCHAS, REFERENCES, DEVIATIONS, *-EVIDENCE
```

## Commands

```bash
yarn lint | yarn format              # all workspaces (next:*, hardhat:*, sdk:* for one)
yarn sdk:test | yarn sdk:test:coverage
yarn sdk:quote --net testnet --in WHBAR --out SAUCE --amount 10
yarn sdk:plan  --net mainnet --in SAUCE --out USDC --amount 5000 [--step 5] [--slippage 50]
yarn hardhat:test                    # offline, mocks; HEDERA_FORKING=true only for yarn hardhat:chain
yarn hardhat:deploy --network hederaTestnet   # reads DEPLOYER_PRIVATE_KEY from root .env or prompts
yarn topic:create [--net testnet]    # HCS receipts topic
yarn seed:testnet                    # TKA/TKB tokens + V1 pair + V2 pool
yarn next:dev | yarn next:build
node scripts/gate-check.mjs --local  # the bounty gate against this checkout
```

## How to add a venue

1. Implement `Venue` (`packages/router-sdk/src/venues/Venue.ts`): `name`, `quoteExactInput(tokenIn, tokenOut, amountIn)` returning `Quote[]` best first with `amountOut` **net of the venue's fees**, `fillable`, `minNotionalOk`; `canExecute(tokenIn, tokenOut)` returning `{ok, reason}`. Return `[]` for "no route", never throw for it. Use `fetchJson` / `ethCall` (timeout, one retry, failover) and `TtlCache` for discovery data.
2. Add the `VenueName` in `types.ts`, register it in `venues/index.ts` (`createVenues`, `VENUE_ORDER`), and give it a `routeKey` in `router/rank.ts`.
3. Add an executor for its plan kind under `execute/` and wire the kind in `router/plan.ts` and the `/swap` page.
4. Tests: mock HTTP with `venues/testkit.ts` (`fakeFetch`, `fakeClient`); keep SDK coverage ≥ 90 %.
5. Add a row to `docs/VENUES.md` and the README venue table, and a `VENUE_LABEL` in `packages/nextjs/lib/router/format.ts`.

## Keep it scaffoldable

- `template.json` must stay valid against the create-scaffold-hbar Zod schema (`docs/REFERENCES.md` has it). New env vars go there (`envVars: {key, description}`), in `.env.example`, in the README table and nowhere else.
- Keep `packages/hardhat`, `packages/nextjs`, root `README.md`, `AGENTS.md`, `LICENSE`. The gate (`scripts/gate-check.mjs`) must stay green: install, lint, tests, build, and every core route returning 200 with **no env configured**.
- No `.env` in git; run `gitleaks git .` before committing. `.yarn/releases` is allow-listed in `.gitleaks.toml`.

## Hedera rules

- Units only through `units.ts`: 8-decimal tinybar in contracts and function arguments, 18-decimal weibar only in transaction `value` / relay balances (`tinybarToWeibar`, `weibarToTinybar`). Token amounts are `bigint` in smallest units; never `number`.
- Associate before transfer: contracts via HTS `0x167` (22 ok, 23 already), users via HIP-719 `associate()` on the token address. `RouterExecutor` caches associations.
- Never call the WHBAR contract directly or approve it; use `WhbarHelper`. Paths use the WHBAR token address for HBAR legs.
- Fetch the V3 signing domain and reactor from `GET /signature/domain` at runtime; sign the *returned* build struct; prefix `0x00` (bot) / `0x01` (wallet). Keep all order integers as strings.
- Secrets are server-only: `DEPLOYER_PRIVATE_KEY`, `HEDERA_OPERATOR_KEY`, `V3_BOT_PRIVATE_KEY`, `LAMBDAPLEX_*`. Nothing secret is ever `NEXT_PUBLIC_`.
- Mainnet money moves only behind `ALLOW_MAINNET_EXECUTION=true` and under `MAINNET_MAX_NOTIONAL_USD`.
- Public relays and the mirror node are rate limited and reject some simulations: use `ethCall` (failover) and cache quotes; label testnet prices "demo liquidity".

## Frontend conventions (Scaffold-HBAR)

- Hooks in `packages/nextjs/hooks/scaffold-hbar`: `useScaffoldReadContract`, `useScaffoldWriteContract`, `useTransactor`, `useTargetNetwork`. The router pages use wagmi directly with the ABI in `lib/router/executorAbi.ts` because the executor address comes from env, not `deployedContracts.ts`.
- Browser code imports `@sh/router-sdk/client` only (types, units, config, pure ranking). Anything that signs or talks to venues runs in `app/api/*` through `lib/router/server.ts`.
- DaisyUI classes over raw Tailwind; `~~/` alias for app imports; `"use client"` on pages with hooks; `type` over `interface`; no `T` prefix.

## Style

`UpperCamelCase` types/components, `lowerCamelCase` functions, `CONSTANT_CASE` constants, `snake_case` deploy files. Concise names, no dead code, no TODOs in shipped code. Comments add information the code does not.
