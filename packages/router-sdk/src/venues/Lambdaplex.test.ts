import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getConfig } from "../config";
import { assetOf, Lambdaplex, walkBook, type LambdaplexDepth, type LambdaplexSymbol } from "./Lambdaplex";
import { fakeFetch, HBAR, SAUCE, USDC, WHBAR } from "./testkit";

const main = getConfig("mainnet");
const sym = (symbol: string, base: string, quote: string, status = "TRADING"): LambdaplexSymbol => ({
  symbol,
  baseAsset: base,
  quoteAsset: quote,
  baseAssetPrecision: 8,
  quoteAssetPrecision: 6,
  status,
  filters: [
    { filterType: "LOT_SIZE", minQty: "1", maxQty: "9", stepSize: "1" },
    { filterType: "MIN_NOTIONAL", minNotional: "5", applyToMarket: true, avgPriceMins: 1 },
  ],
});
const info = { exchangeSymbols: [sym("HBAR-USDC", "HBAR", "USDC"), sym("SAUCE-USDC", "SAUCE", "USDC", "PAUSED")] };
const depth: LambdaplexDepth = {
  lastUpdateId: 1,
  bids: [
    ["0.10", "100"],
    ["0.09", "100"],
  ],
  asks: [
    ["0.11", "100"],
    ["0.12", "100"],
  ],
};

describe("walkBook", () => {
  it("SELL consumes bids best-first and reports fillability", () => {
    const r = walkBook(depth, "SELL", 150n * 10n ** 8n, 8, 6);
    expect(r.amountOut).toBe(10_000_000n + 4_500_000n); // 100@0.10 + 50@0.09 in USDC units
    expect(r.fillable).toBe(true);
    expect(r.levels).toBe(2);
    const big = walkBook(depth, "SELL", 500n * 10n ** 8n, 8, 6);
    expect(big.fillable).toBe(false);
    expect(big.consumed).toBe(200n * 10n ** 8n);
  });

  it("BUY spends quote against asks", () => {
    const r = walkBook(depth, "BUY", 12_000_000n, 6, 8); // 12 USDC
    // 11 USDC buys 100 HBAR at 0.11, remaining 1 USDC buys 8.333.. HBAR at 0.12
    expect(r.amountOut).toBe(100n * 10n ** 8n + 833_333_333n);
    expect(r.fillable).toBe(true);
    expect(walkBook({ lastUpdateId: 1, bids: [], asks: [] }, "BUY", 1n, 6, 8).fillable).toBe(false);
  });
});

describe("Lambdaplex", () => {
  it("is mainnet-only", async () => {
    const lp = new Lambdaplex(getConfig("testnet"));
    expect(await lp.canExecute(HBAR, USDC)).toEqual({ ok: false, reason: "Lambdaplex is mainnet-only" });
    expect(await lp.quoteExactInput(HBAR, USDC, 1n)).toEqual([]);
  });

  it("quotes from public depth with an estimated taker fee when unkeyed", async () => {
    const fetchImpl = fakeFetch({
      "/api/v1/exchangeInfo": { body: info },
      "/api/v1/depth?symbol=HBAR-USDC": { body: depth },
    });
    const lp = new Lambdaplex(main, { fetchImpl, takerBpsEstimate: 25 });
    const [q] = await lp.quoteExactInput(HBAR, USDC, 100n * 10n ** 8n);
    expect(q!.symbol).toBe("HBAR-USDC");
    expect(q!.side).toBe("SELL");
    expect(q!.feeOut).toBe(25_000n);
    expect(q!.amountOut).toBe(10_000_000n - 25_000n);
    expect(q!.minNotionalOk).toBe(true);
    expect(q!.detail?.feeSource).toBe("estimate 25 bps");
    expect(await lp.canExecute(HBAR, USDC)).toEqual({
      ok: false,
      reason: "quote-only: no Lambdaplex API key configured",
    });
    expect(assetOf(HBAR)).toBe("HBAR");
    expect(assetOf(WHBAR)).toBe("WHBAR");
  });

  it("uses the signed fee-quote when keyed and reports executable", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("hex");
    const fetchImpl = fakeFetch({
      "/api/v1/exchangeInfo": { body: info },
      "/api/v1/depth?symbol=HBAR-USDC": { body: depth },
      "/api/v1/order/fee-quote": (url, init) => {
        const h = init?.headers as Record<string, string>;
        if (h["X-API-KEY"] !== "k1" || !url.includes("signature=") || !url.includes("quantity=100"))
          return { status: 401, body: {} };
        return {
          body: {
            vwap: "0.1",
            feePreview: { estimatedAppliedTakerBps: 12, estimatedTakerFee: "0.012", estimatedNetReceived: "9.988" },
          },
        };
      },
    });
    const lp = new Lambdaplex(main, { fetchImpl, credentials: { apiKey: "k1", ed25519Seed: seed } });
    const [q] = await lp.quoteExactInput(HBAR, USDC, 100n * 10n ** 8n);
    expect(q!.amountOut).toBe(9_988_000n);
    expect(q!.detail?.feeSource).toBe("fee-quote 12 bps");
    expect(await lp.canExecute(HBAR, USDC)).toEqual({ ok: true });
  });

  it("handles BUY side, paused symbols and missing pairs", async () => {
    const fetchImpl = fakeFetch({
      "/api/v1/exchangeInfo": { body: info },
      "/api/v1/depth?symbol=HBAR-USDC": { body: depth },
    });
    const lp = new Lambdaplex(main, { fetchImpl });
    const [buy] = await lp.quoteExactInput(USDC, HBAR, 11_000_000n);
    expect(buy!.side).toBe("BUY");
    expect(buy!.amountOut).toBeGreaterThan(0n);
    expect(await lp.canExecute(SAUCE, USDC)).toEqual({ ok: false, reason: "SAUCE-USDC is PAUSED" });
    expect(await lp.quoteExactInput(SAUCE, USDC, 1n)).toEqual([]);
    expect(await lp.canExecute(SAUCE, WHBAR)).toEqual({ ok: false, reason: "no Lambdaplex symbol for this pair" });
    const down = new Lambdaplex(main, { fetchImpl: fakeFetch({}) });
    expect((await down.canExecute(HBAR, USDC)).reason).toMatch(/Lambdaplex API unavailable/);
  });
});
