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
  mirrorUrl: string;
  hashscanUrl: string;
  v3ApiUrl: string;
  v3WsUrl: string;
  lambdaplexApiUrl?: string;
  saucer: SaucerAddresses;
  tokens: Record<string, Token>;
};
