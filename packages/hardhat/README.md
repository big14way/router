# Hardhat package

`RouterExecutor.sol`, the only contract in this template: it runs a router plan's V1/V2 legs in one transaction, checks each leg's `minOut` and the plan's `totalMinOut`, associates itself with HTS tokens through the `0x167` system contract, and emits `RouteExecuted(…, planHash)` for the HCS receipt to point at.

## Layout

- `contracts/RouterExecutor.sol` — the executor; `contracts/interfaces/` — SaucerSwap and HTS interfaces it calls
- `contracts/mocks/` — mock routers, ERC-20 and HTS used by the offline tests
- `test/RouterExecutor.test.ts` — 11 tests against the mocks (no network, no keys)
- `deploy/00_deploy_executor.ts` — deploys `RouterExecutor` with the SaucerSwap V1 router, V2 swap router, WHBAR token and WHBAR helper of the target network (chain 295 uses mainnet addresses, anything else testnet)
- `scripts/` — account generation/import, the deploy wrapper and `verifySourcify.ts`
- `hardhat.config.ts` — networks `hardhat` (offline, or a forked Hedera testnet when `HEDERA_FORKING=true`), `localhost`, `hederaTestnet`, `hederaMainnet`

## Test

From the repo root:

```bash
yarn hardhat:test       # offline against the mocks, with a gas report
```

## Deploy and verify

1. **Deployer key.** Put a funded ECDSA key in the root `.env` as `DEPLOYER_PRIVATE_KEY` (non-interactive), or run `yarn hardhat:account:generate` / `yarn hardhat:account:import` to store an encrypted key that `yarn hardhat:deploy` asks the password for. Fund the EVM address at the [Hedera Portal faucet](https://portal.hedera.com/faucet).
2. **Deploy.**
   ```bash
   yarn hardhat:deploy --network hederaTestnet    # or hederaMainnet
   ```
   It prints the HashScan link and `NEXT_PUBLIC_ROUTER_EXECUTOR=0x…` for the root `.env`.
3. **Verify on Sourcify** (shows as verified on HashScan). The script submits the solc standard JSON from `artifacts/build-info` to the Sourcify v2 API:
   ```bash
   yarn hardhat:verify -- RouterExecutor testnet               # address from deployments/hederaTestnet/
   yarn hardhat:verify -- RouterExecutor testnet 0xAddress     # explicit address
   ```
   Use `mainnet` for chain 295.

## Local fork (optional)

`yarn hardhat:chain` starts `hardhat node` forking Hedera testnet with the HTS system-contract emulation (`@hashgraph/system-contracts-forking`), served at http://127.0.0.1:8545. Deploy to it from a second terminal with `yarn hardhat:deploy --network localhost`; the deploy script wires it to the testnet SaucerSwap addresses.
