# References

Notes taken from the live docs before each phase. Dates are when the page was read.

## Phase 0 — Scaffold-HBAR (read 2 Oct 2026)

Sources:

- https://docs.hedera.com/solutions/tools/scaffold-hbar.md
- https://docs.hedera.com/solutions/tools/scaffold-hbar/scaffold-ui.md
- https://github.com/hedera-dev/scaffold-hbar (templates live on `templates/*` branches; `blank` = `templates/blank-template`)
- https://github.com/hedera-dev/create-scaffold-hbar (`src/types.ts`, `contributors/TEMPLATES.md`)
- https://hedera.com/blog/scaffold-hbar-template-bounty/

### CLI

- `create-scaffold-hbar` version used for the baseline: **0.4.1** (`npm view create-scaffold-hbar version`).
- Flags: `--template|-t <key|org/repo[#branch]>`, `--frontend|-f nextjs-app|none`,
  `--solidity-framework|-s hardhat|foundry|none`, `--network testnet|mainnet`,
  `--package-manager yarn|npm`, `--destination|-d`, `--skip-install`, `--skip-hedera-skills`,
  `--install-hedera-skills`, `--yes|-y`, `--ci`.
- Community templates are fetched with giget from `gh:owner/repo#ref`; the repo's `template.json`
  is read from GitHub to constrain prompts. The CLI then removes the unselected Solidity package,
  rewrites root `package.json`, optionally rewrites yarn→npm, and runs `processTemplateManifest`.
- Local gate seam: `CREATE_SCAFFOLD_HBAR_TEMPLATE_DIR=<dir>` makes the CLI copy a local tree instead
  of downloading (skips `.git`, `node_modules`, build output, `.env`).
- Baseline command used:

  ```bash
  npm create scaffold-hbar@latest hedera-smart-order-router -- \
    --template blank --frontend nextjs-app --solidity-framework hardhat \
    --network testnet --package-manager yarn --skip-install --skip-hedera-skills --ci
  ```

- Baseline facts: Node ≥ 20.18.3, Yarn 3.2.3 pinned via `packageManager` + `.yarn/releases`,
  `nodeLinker: node-modules`, workspaces `packages/hardhat` + `packages/nextjs`,
  Next.js 15 / React 19 / wagmi 2 / viem 2 / RainbowKit 2 / DaisyUI 5, Hardhat 2.22 + hardhat-deploy,
  Solidity 0.8.28, `@hiero-ledger/sdk` already a nextjs dependency (reuse it for HCS).

### `template.json` schema (Zod, from `src/types.ts` of create-scaffold-hbar 0.4.1)

```ts
EnvVar        = { key: string(min 1), description: string }
RenameEntry   = { to: string(min 1), paths: string[](min 1) }
Capabilities  = { frontend?: ("nextjs-app"|"none")[], solidityFramework?: ("hardhat"|"foundry"|"none")[],
                  packageManager?: ("yarn"|"npm"|"none")[] }
Defaults      = { frontend?, solidityFramework?, packageManager? }   // same enums, single values
OutroStep     = { label?, command?, url?, text? }                      // at least one required
OutroSection  = { title?, steps: OutroStep[](min 1) }
Outro         = { sections?: OutroSection[], steps?: string[] (deprecated), installCommand?: string }
ManifestBlock = { rename?: Record<string, RenameEntry>, instructions?: string[],
                  requirements?: Record<string, semverRange>, envVars?: EnvVar[],
                  capabilities?: Capabilities, defaults?: Defaults, outro?: Outro }
Manifest      = { name: string(min 1), description?: string, version?: string,
                  "create-scaffold-hbar"?: ManifestBlock }
```

- `envVars` entries are `{key, description}` only; the CLI writes them to `.env.example` as
  `# description` / `KEY=` pairs (`src/tasks/generate-env-example.ts`).
- Legacy key `create-hbar` is normalised to `create-scaffold-hbar`.
- `{run:script}`, `{run:framework:script}` and `{pm}` placeholders expand inside outro steps.

### Bounty eligibility gate (blog)

Public MIT repo, monorepo `packages/*`, valid `template.json`, `README.md` + `AGENTS.md`, install/lint/build
clean, app boots with core routes 200, at least one Hedera service with a verifiable testnet transaction
(HashScan or mirror link), no committed secrets/`.env`. Rubric: ecosystem integration 35, docs 30,
code quality 20, Hedera service depth 15.

## Phase 2 — units, addresses, HTS (read 2 Oct 2026)

Sources:

- https://docs.hedera.com/evm/differences/hbar-decimals.md — "Within the EVM environment, HBAR maintains 8 decimal places"; "msg.value in JSON-RPC Relay represents HBAR with 18 decimal places"; 1 tinybar = 10^10 weibar.
- https://docs.hedera.com/evm/development/gas-fees.md — HIP-1249: minimum gas charges eliminated, unused gas refunded; 15M gas per-transaction cap; gas info returned in weibar (HIP-410). See DEVIATIONS D-1.
- https://docs.hedera.com/evm/development/json-rpc/index.md — Hashio testnet `https://testnet.hashio.io/api` (296), mainnet `https://mainnet.hashio.io/api` (295); "for development and testing purposes only".
- https://docs.hedera.com/evm/hedera-services/system-contracts/hts.md — system contract `0x167`; `associateToken(address,address)`; SUCCESS 22, TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT 23; HIP-719 facade `associate()/dissociate()/isAssociated()` on the token address.
- https://docs.hedera.com/evm/tokens/erc20.md — HTS fungible tokens expose `approve/allowance/transfer/transferFrom/balanceOf/decimals/name/symbol` on their EVM address.
- https://docs.saucerswap.finance/developers/contracts.md — all IDs below.
- https://docs.saucerswap.finance/developers/whbar/overview.md, `/wrap-hbar-for-whbar.md`, `/unwrap-whbar-for-hbar.md` — never use WHBAR directly; `WhbarHelper.deposit()` payable, `WhbarHelper.unwrapWhbar(uint256 wad)` after approving the helper.
- https://docs.saucerswap.finance/protocol/routing.md — "The smart order router is part of the SaucerSwap app and is not exposed as a public API."; V3 chosen only when current, fully executable and ≥ 5 bps better than the AMM quote.

### Address verification (mirror node, 2 Oct 2026)

All contract IDs returned `deleted:false` with the long-zero EVM address shown; tokens returned the expected symbol and decimals.

| Network | Contract / token | ID | EVM |
|---|---|---|---|
| testnet | V1 Factory | 0.0.9959 | 0x…26e7 |
| testnet | V1 RouterV3 | 0.0.19264 | 0x…4b40 |
| testnet | V2 Factory | 0.0.1197038 | 0x…1243ee |
| testnet | V2 SwapRouter | 0.0.1414040 | 0x…159398 |
| testnet | V2 QuoterV2 | 0.0.1390002 | 0x…1535b2 |
| testnet | V2 NonfungiblePositionManager | 0.0.1308184 | 0x…13f618 |
| testnet | WHBAR contract / token | 0.0.15057 / 0.0.15058 | 0x…3ad1 / 0x…3ad2 (8 dec) |
| testnet | WhbarHelper | 0.0.5286055 | 0x…50a8a7 |
| testnet | SAUCE | 0.0.1183558 | 0x…120f46 (6 dec) |
| testnet | USDC (SaucerSwap) | 0.0.5449 | 0x…1549 (6 dec) |
| mainnet | V1 Factory | 0.0.1062784 | 0x…103780 |
| mainnet | V1 RouterV3 | 0.0.3045981 | 0x…2e7a5d |
| mainnet | V2 Factory | 0.0.3946833 | 0x…3c3951 |
| mainnet | V2 SwapRouter | 0.0.3949434 | 0x…3c437a |
| mainnet | V2 QuoterV2 | 0.0.3949424 | 0x…3c4370 |
| mainnet | V2 NonfungiblePositionManagerV2 | 0.0.4053945 | 0x…3ddbb9 |
| mainnet | WHBAR contract / token | 0.0.1456985 / 0.0.1456986 | 0x…163b59 / 0x…163b5a (8 dec) |
| mainnet | WhbarHelper | 0.0.5808826 | 0x…58a2ba |
| mainnet | SAUCE | 0.0.731861 | 0x…b2ad5 (6 dec) |
| mainnet | USDC | 0.0.456858 | 0x…6f89a (6 dec) |

Empirical unit check: `eth_getBalance` for 0.0.19264 on Hashio = 55 × 10^18 weibar; mirror node balance = 5 500 000 000 tinybar → ratio exactly 10^10. `decimals()` on WHBAR token 0x…3ad2 = 8.

### Live venue state (2 Oct 2026)

- V3 testnet `GET /books`: 7 books; only book 3 SAUCE/USDC (0.0.1183558 / 0.0.5449) is `OPEN`, and it has `isMarketHalted:1`. Books 1, 2, 4, 5, 10, 11 are `CLOSED`. `minNotional` 1.
- V3 mainnet `GET /books`: 5 books `OPEN`, unhalted, `isAMMEnabled:1`: 1 HBAR/USDC, 2 SAUCE/USDC, 3 WBTC/USDC, 4 WETH/USDC, 5 USDT0/USDC; `minNotional` 15000000 (15 USDC); taker 1200 pips (0.12%) except USDT0 600; maker 0.
- `GET /signature/domain` is public on both: testnet reactor `0x5707B946EE64bD750A587261Ce36ec7024F3088B` (chain 296), mainnet `0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C` (chain 295), name `PartialFillLimitOrderReactor` v1. Never hardcoded; fetched at runtime.
- Lambdaplex `GET /api/v1/exchangeInfo`, `/depth`, `/time` answer without an API key. 13 symbols `TRADING` including HBAR-USDC, SAUCE-USDC, WETH-USDC, WBTC-USDC. `MIN_NOTIONAL` 5 USDC.
