import type { Network } from "../types";
import { mainnet } from "./mainnet";
import { testnet } from "./testnet";
import type { NetworkConfig } from "./types";

export type { NetworkConfig, SaucerAddresses } from "./types";
export { mainnet, testnet };

/** SaucerSwap V2 fee tiers in hundredths of a bip (0.05%, 0.15%, 0.30%, 1.00%). */
export const V2_FEE_TIERS = [500, 1500, 3000, 10000] as const;

/** V3 wins over the best AMM only when its all-in output is at least this much better. */
export const V3_EDGE_BPS = 5;

export function getConfig(network: Network, overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  const base = network === "mainnet" ? mainnet : testnet;
  return {
    ...base,
    ...overrides,
    saucer: { ...base.saucer, ...overrides.saucer },
    tokens: { ...base.tokens, ...overrides.tokens },
  };
}

export function parseNetwork(value: string | undefined): Network {
  if (value === "mainnet" || value === "testnet") return value;
  if (value === undefined || value === "") return "testnet";
  throw new Error(`unknown network: ${value}`);
}
