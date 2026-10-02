import type { Address } from "viem";
import type { NetworkConfig } from "./types";

/**
 * Hedera testnet (chain 296). Every ID was checked against the mirror node on 2 Oct 2026
 * (`/api/v1/contracts/{id}` and `/api/v1/tokens/{id}`), see docs/REFERENCES.md.
 * Source: https://docs.saucerswap.finance/developers/contracts
 */
export const testnet: NetworkConfig = {
  network: "testnet",
  chainId: 296,
  rpcUrl: "https://testnet.hashio.io/api",
  mirrorUrl: "https://testnet.mirrornode.hedera.com",
  hashscanUrl: "https://hashscan.io/testnet",
  v3ApiUrl: "https://testnet-orderbook-api.saucerswap.finance",
  v3WsUrl: "wss://testnet-orderbook-api.saucerswap.finance",
  /** Lambdaplex has no testnet; the adapter is mainnet-only. */
  lambdaplexApiUrl: undefined,
  saucer: {
    // https://hashscan.io/testnet/contract/0.0.9959
    v1Factory: "0x00000000000000000000000000000000000026e7" as Address,
    // https://hashscan.io/testnet/contract/0.0.19264 (UniswapV2-style RouterV3)
    v1Router: "0x0000000000000000000000000000000000004b40" as Address,
    // https://hashscan.io/testnet/contract/0.0.1197038
    v2Factory: "0x00000000000000000000000000000000001243ee" as Address,
    // https://hashscan.io/testnet/contract/0.0.1414040
    v2SwapRouter: "0x0000000000000000000000000000000000159398" as Address,
    // https://hashscan.io/testnet/contract/0.0.1390002
    v2Quoter: "0x00000000000000000000000000000000001535b2" as Address,
    // https://hashscan.io/testnet/contract/0.0.1308184
    v2PositionManager: "0x000000000000000000000000000000000013f618" as Address,
    // https://hashscan.io/testnet/contract/0.0.15057 (never call directly; use WhbarHelper)
    whbarContract: "0x0000000000000000000000000000000000003ad1" as Address,
    // https://hashscan.io/testnet/contract/0.0.5286055
    whbarHelper: "0x000000000000000000000000000000000050a8a7" as Address,
  },
  tokens: {
    HBAR: {
      id: "0.0.0",
      evm: "0x0000000000000000000000000000000000000000",
      symbol: "HBAR",
      name: "HBAR",
      decimals: 8,
      native: true,
    },
    // https://hashscan.io/testnet/token/0.0.15058
    WHBAR: {
      id: "0.0.15058",
      evm: "0x0000000000000000000000000000000000003ad2",
      symbol: "WHBAR",
      name: "Wrapped Hbar",
      decimals: 8,
    },
    // https://hashscan.io/testnet/token/0.0.1183558
    SAUCE: {
      id: "0.0.1183558",
      evm: "0x0000000000000000000000000000000000120f46",
      symbol: "SAUCE",
      name: "Sauce",
      decimals: 6,
    },
    // https://hashscan.io/testnet/token/0.0.5449 (SaucerSwap's testnet USDC, not Circle's faucet USDC)
    USDC: {
      id: "0.0.5449",
      evm: "0x0000000000000000000000000000000000001549",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  },
};
