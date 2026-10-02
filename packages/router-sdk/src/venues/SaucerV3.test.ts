import { describe, expect, it } from "vitest";
import { SaucerV3, type V3Book } from "./SaucerV3";
import { cfg, fakeFetch, HBAR, SAUCE, USDC, WHBAR } from "./testkit";

const book = (over: Partial<V3Book>): V3Book => ({
  id: "3",
  baseTokenId: SAUCE.id,
  quoteTokenId: USDC.id,
  baseTokenEvmAddress: SAUCE.evm,
  quoteTokenEvmAddress: USDC.evm,
  status: "OPEN",
  isAMMEnabled: 1,
  isMarketHalted: 0,
  baseTokenSymbol: "SAUCE",
  quoteTokenSymbol: "USDC",
  baseTokenDecimals: 6,
  quoteTokenDecimals: 6,
  tickStep: "0.00001",
  sizeStep: "0.1",
  lotSize: "100000",
  minNotional: "15000000",
  takerFeePips: 1200,
  makerFeePips: 0,
  ...over,
});

const hbarBook = book({
  id: "1",
  baseTokenId: "0.0.0",
  baseTokenEvmAddress: "0x0000000000000000000000000000000000000000",
  baseTokenSymbol: "HBAR",
  baseTokenDecimals: 8,
});

describe("SaucerV3", () => {
  it("quotes SELL on an open book, deducts the taker fee and checks minNotional", async () => {
    const fetchImpl = fakeFetch({
      "/books/3/quote/exact-input": {
        body: {
          outputToken: USDC.evm,
          snappedInputAmount: "100000000",
          consumedInputAmount: "100000000",
          expectedOutputAmount: "1322000",
          suggestedOutputAmount: "1255000",
          slippageBps: 500,
          fillable: true,
        },
      },
      "/books": { body: { orderbooks: [book({})] } },
    });
    const v3 = new SaucerV3(cfg, { fetchImpl, now: () => 7 });
    const [q] = await v3.quoteExactInput(SAUCE, USDC, 100_000_000n);
    expect(q!.bookId).toBe("3");
    expect(q!.side).toBe("SELL");
    expect(q!.feeOut).toBe((1_322_000n * 1200n) / 1_000_000n);
    expect(q!.amountOut).toBe(1_322_000n - q!.feeOut!);
    expect(q!.fillable).toBe(true);
    expect(q!.minNotionalOk).toBe(false); // 1.322 USDC < 15 USDC
    expect(q!.detail?.onGrid).toBe(true);
    expect(fetchImpl.calls.find(u => u.includes("inputToken="))).toContain(`inputToken=${SAUCE.evm}`);
    expect(await v3.canExecute(SAUCE, USDC)).toEqual({ ok: true });
  });

  it("quotes BUY when the input is the quote token and snaps off-grid input", async () => {
    const fetchImpl = fakeFetch({
      "/books/1/quote/exact-input": {
        body: {
          outputToken: "0x0",
          snappedInputAmount: "20000000",
          consumedInputAmount: "20000000",
          expectedOutputAmount: "20062192797",
          suggestedOutputAmount: "16000000000",
          slippageBps: 500,
          fillable: true,
        },
      },
      "/books": { body: { orderbooks: [hbarBook] } },
    });
    const v3 = new SaucerV3(cfg, { fetchImpl });
    const [q] = await v3.quoteExactInput(USDC, HBAR, 20_000_123n);
    expect(q!.side).toBe("BUY");
    expect(q!.amountIn).toBe(20_000_000n);
    expect(q!.detail?.onGrid).toBe(false);
    expect(q!.detail?.remainder).toBe("123");
    expect(q!.minNotionalOk).toBe(true);
  });

  it("is unavailable (not an error) when the book is closed, halted, or missing", async () => {
    const fetchImpl = fakeFetch({
      "/books": { body: { orderbooks: [book({ id: "9", status: "CLOSED" }), book({ id: "3", isMarketHalted: 1 })] } },
    });
    const v3 = new SaucerV3(cfg, { fetchImpl });
    expect(await v3.canExecute(SAUCE, USDC)).toEqual({ ok: false, reason: "book 9 is CLOSED" });
    expect(await v3.quoteExactInput(SAUCE, USDC, 1n)).toEqual([]);
    expect(await v3.canExecute(WHBAR, SAUCE)).toEqual({ ok: false, reason: "no V3 book for this pair" });
    const halted = new SaucerV3(cfg, {
      fetchImpl: fakeFetch({ "/books": { body: { orderbooks: [book({ isMarketHalted: 1 })] } } }),
    });
    expect(await halted.canExecute(SAUCE, USDC)).toEqual({ ok: false, reason: "book 3 is OPEN but market is halted" });
  });

  it("marks unfillable quotes and partially consumed input", async () => {
    const fetchImpl = fakeFetch({
      "/books/3/quote/exact-input": {
        body: {
          outputToken: USDC.evm,
          snappedInputAmount: "10000000",
          consumedInputAmount: "0",
          expectedOutputAmount: "0",
          suggestedOutputAmount: "1",
          slippageBps: 500,
          fillable: false,
        },
      },
      "/books": { body: { orderbooks: [book({})] } },
    });
    const [q] = await new SaucerV3(cfg, { fetchImpl }).quoteExactInput(SAUCE, USDC, 10_000_000n);
    expect(q!.fillable).toBe(false);
    expect(q!.amountOut).toBe(0n);
  });

  it("falls back to JWT on 401 when a bot is configured, else reports unavailable", async () => {
    let hits = 0;
    const fetchImpl = fakeFetch({
      "/books": (_url, init) => {
        hits += 1;
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        return auth ? { body: { orderbooks: [book({})] } } : { status: 401, body: { error: "jwt required" } };
      },
    });
    const withBot = new SaucerV3(cfg, { fetchImpl, authHeaders: async () => ({ Authorization: "Bearer t" }) });
    expect((await withBot.canExecute(SAUCE, USDC)).ok).toBe(true);
    expect(hits).toBe(2);
    const noBot = new SaucerV3(cfg, { fetchImpl });
    expect(await noBot.canExecute(SAUCE, USDC)).toEqual({
      ok: false,
      reason: "V3 API unavailable: endpoint requires JWT and no V3 bot account is configured",
    });
  });

  it("caches /books for a minute and surfaces other HTTP errors", async () => {
    const fetchImpl = fakeFetch({ "/books": { body: { orderbooks: [book({})] } } });
    const v3 = new SaucerV3(cfg, { fetchImpl });
    await v3.listBooks();
    await v3.listBooks();
    expect(fetchImpl.calls.filter(u => u.endsWith("/books"))).toHaveLength(1);
    const down = new SaucerV3(cfg, { fetchImpl: fakeFetch({ "/books": { status: 500, body: { error: "boom" } } }) });
    expect((await down.canExecute(SAUCE, USDC)).reason).toMatch(/V3 API unavailable: HTTP 500/);
  });
});
