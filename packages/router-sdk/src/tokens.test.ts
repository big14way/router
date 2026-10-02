import { describe, expect, it } from "vitest";
import { getConfig, mainnet, parseNetwork, testnet } from "./config";
import { ammToken, htsToken, resolveToken, sameToken } from "./tokens";
import { entityToAddress } from "./units";

describe("config", () => {
  it("long-zero addresses match entity ids on both networks", () => {
    for (const cfg of [testnet, mainnet]) {
      for (const t of Object.values(cfg.tokens)) {
        if (!t.native) expect(entityToAddress(t.id).toLowerCase()).toBe(t.evm.toLowerCase());
      }
    }
  });

  it("selects and overrides config", () => {
    expect(getConfig("testnet").chainId).toBe(296);
    expect(getConfig("mainnet").chainId).toBe(295);
    const c = getConfig("testnet", { rpcUrl: "http://localhost:7546" });
    expect(c.rpcUrl).toBe("http://localhost:7546");
    expect(c.saucer.v1Router).toBe(testnet.saucer.v1Router);
    expect(parseNetwork(undefined)).toBe("testnet");
    expect(parseNetwork("mainnet")).toBe("mainnet");
    expect(() => parseNetwork("previewnet")).toThrow(/unknown network/);
  });
});

describe("tokens", () => {
  const cfg = getConfig("testnet");
  it("resolves by symbol, id and address, case-insensitively", () => {
    expect(resolveToken(cfg, "sauce").id).toBe("0.0.1183558");
    expect(resolveToken(cfg, "0.0.5449").symbol).toBe("USDC");
    expect(resolveToken(cfg, "0x0000000000000000000000000000000000003AD2").symbol).toBe("WHBAR");
    expect(() => resolveToken(cfg, "DOGE")).toThrow(/unknown token/);
    expect(() => resolveToken(cfg, "0.0.1")).toThrow(/unknown token/);
  });

  it("maps HBAR to WHBAR for AMM paths", () => {
    expect(ammToken(cfg, cfg.tokens.HBAR!).symbol).toBe("WHBAR");
    expect(ammToken(cfg, cfg.tokens.SAUCE!).symbol).toBe("SAUCE");
    expect(sameToken(cfg.tokens.HBAR!, cfg.tokens.HBAR!)).toBe(true);
    expect(sameToken(cfg.tokens.HBAR!, cfg.tokens.WHBAR!)).toBe(false);
  });

  it("builds ad-hoc HTS tokens", () => {
    const t = htsToken("0.0.123", "TKA", 8);
    expect(t.evm.toLowerCase()).toBe("0x000000000000000000000000000000000000007b");
    expect(t.name).toBe("TKA");
  });
});
