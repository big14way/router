import * as dotenv from "dotenv";
import path from "path";
// Root .env (template-wide, generated from template.json envVars) then the package-local one.
dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config();

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
// Only load the Hedera forking plugin when starting the local node (yarn hardhat:chain / yarn hardhat:fork).
// Deploying to an already-running node doesn't need it and would fail with EADDRINUSE.
if (process.env.HEDERA_FORKING === "true") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- conditional plugin load
  require("@hashgraph/system-contracts-forking/plugin");
}
import "hardhat-deploy";
import "hardhat-deploy-ethers";

import generateTsAbis from "./scripts/generateTsAbis";

// Hedera JSON-RPC URL (testnet default). Set HEDERA_RPC_URL in .env for mainnet.
const hederaRpcUrl = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";

// Deployer key, in order: decrypted at runtime by `yarn deploy` (__RUNTIME_DEPLOYER_PRIVATE_KEY),
// a plain DEPLOYER_PRIVATE_KEY from .env (CI / non-interactive), else Hardhat's well-known dev key.
const deployerPrivateKey =
  process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY ??
  process.env.DEPLOYER_PRIVATE_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  networks: {
    hardhat: {
      // Fork Hedera testnet only when the forking plugin is on (yarn hardhat:chain / hardhat:fork);
      // plain `hardhat test` runs offline against the mocks.
      ...(process.env.HEDERA_FORKING === "true"
        ? {
            forking: {
              url: hederaRpcUrl,
              // @ts-expect-error - custom property for hedera-forking plugin
              chainId: 296,
              workerPort: 10001,
            },
          }
        : {}),
    },
    hederaTestnet: {
      url: "https://testnet.hashio.io/api",
      accounts: [deployerPrivateKey],
      chainId: 296,
    },
    hederaMainnet: {
      url: "https://mainnet.hashio.io/api",
      accounts: [deployerPrivateKey],
      chainId: 295,
    },
  },
  // Contract verification: use `yarn verify:contract` (scripts/verifySourcify.ts), which talks
  // directly to the Sourcify API v2. @nomicfoundation/hardhat-verify is intentionally not used:
  // its Hardhat 2-compatible line only speaks the Sourcify API v1, which Sourcify removed in
  // July 2026. See: https://docs.sourcify.dev/blog/api-v1-brownouts/
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

// Extend the deploy task to also generate TypeScript ABIs after deployment.
task("deploy").setAction(async (args, hre, runSuper) => {
  await runSuper(args);
  await generateTsAbis(hre);
});

export default config;
