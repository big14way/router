import type { Address } from "viem";
import type { Network, Token } from "../types";

export type SaucerAddresses = {
  v1Factory: Address;
  v1Router: Address;
  v2Factory: Address;
  v2SwapRouter: Address;
  v2Quoter: Address;
  v2PositionManager: Address;
  whbarContract: Address;
  whbarHelper: Address;
};

export type NetworkConfig = {
  network: Network;
  chainId: 295 | 296;
  rpcUrl: string;
  /** Extra JSON-RPC relays tried in order when the primary fails a read (public relays are rate limited and
   *  the mirror-node-backed ones reject heavy simulations such as QuoterV2 on mainnet). */
  fallbackRpcUrls: string[];
  mirrorUrl: string;
  hashscanUrl: string;
  v3ApiUrl: string;
  v3WsUrl: string;
  lambdaplexApiUrl?: string;
  saucer: SaucerAddresses;
  tokens: Record<string, Token>;
};
