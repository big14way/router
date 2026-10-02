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
