import type { Address } from "viem";
import type { NetworkConfig } from "./types";

/**
 * Hedera mainnet (chain 295). Every ID was checked against the mirror node on 2 Oct 2026.
 * Source: https://docs.saucerswap.finance/developers/contracts
 * Execution here is opt-in: see ALLOW_MAINNET_EXECUTION / MAINNET_MAX_NOTIONAL_USD.
 */
export const mainnet: NetworkConfig = {
  network: "mainnet",
  chainId: 295,
  rpcUrl: "https://mainnet.hashio.io/api",
  mirrorUrl: "https://mainnet.mirrornode.hedera.com",
  hashscanUrl: "https://hashscan.io/mainnet",
  v3ApiUrl: "https://orderbook-api.saucerswap.finance",
  v3WsUrl: "wss://orderbook-api.saucerswap.finance",
  lambdaplexApiUrl: "https://api.lambdaplex.io",
  saucer: {
    // https://hashscan.io/mainnet/contract/0.0.1062784
    v1Factory: "0x0000000000000000000000000000000000103780" as Address,
    // https://hashscan.io/mainnet/contract/0.0.3045981
    v1Router: "0x00000000000000000000000000000000002e7a5d" as Address,
    // https://hashscan.io/mainnet/contract/0.0.3946833
    v2Factory: "0x00000000000000000000000000000000003c3951" as Address,
    // https://hashscan.io/mainnet/contract/0.0.3949434
    v2SwapRouter: "0x00000000000000000000000000000000003c437a" as Address,
    // https://hashscan.io/mainnet/contract/0.0.3949424
    v2Quoter: "0x00000000000000000000000000000000003c4370" as Address,
    // https://hashscan.io/mainnet/contract/0.0.4053945
    v2PositionManager: "0x00000000000000000000000000000000003ddbb9" as Address,
    // https://hashscan.io/mainnet/contract/0.0.1456985 (never call directly; use WhbarHelper)
    whbarContract: "0x0000000000000000000000000000000000163b59" as Address,
    // https://hashscan.io/mainnet/contract/0.0.5808826
    whbarHelper: "0x000000000000000000000000000000000058a2ba" as Address,
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
    // https://hashscan.io/mainnet/token/0.0.1456986
    WHBAR: {
      id: "0.0.1456986",
      evm: "0x0000000000000000000000000000000000163b5a",
      symbol: "WHBAR",
      name: "Wrapped Hbar",
      decimals: 8,
    },
    // https://hashscan.io/mainnet/token/0.0.731861
    SAUCE: {
      id: "0.0.731861",
      evm: "0x00000000000000000000000000000000000b2ad5",
      symbol: "SAUCE",
      name: "SAUCE",
      decimals: 6,
    },
    // https://hashscan.io/mainnet/token/0.0.456858
    USDC: {
      id: "0.0.456858",
      evm: "0x000000000000000000000000000000000006f89a",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
  },
};
