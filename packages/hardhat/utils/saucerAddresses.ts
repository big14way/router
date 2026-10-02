/**
 * SaucerSwap periphery addresses used by the deploy script. Same values as
 * packages/router-sdk/src/config (verified on the mirror node, see docs/REFERENCES.md);
 * duplicated here because the Hardhat package is CommonJS and the SDK is ESM.
 */
export const saucerAddresses = {
  testnet: {
    v1Router: "0x0000000000000000000000000000000000004b40", // 0.0.19264
    v2SwapRouter: "0x0000000000000000000000000000000000159398", // 0.0.1414040
    whbarToken: "0x0000000000000000000000000000000000003ad2", // 0.0.15058
    whbarHelper: "0x000000000000000000000000000000000050a8a7", // 0.0.5286055
  },
  mainnet: {
    v1Router: "0x00000000000000000000000000000000002e7a5d", // 0.0.3045981
    v2SwapRouter: "0x00000000000000000000000000000000003c437a", // 0.0.3949434
    whbarToken: "0x0000000000000000000000000000000000163b5a", // 0.0.1456986
    whbarHelper: "0x000000000000000000000000000000000058a2ba", // 0.0.5808826
  },
} as const;
