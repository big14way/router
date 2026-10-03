import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { getConfig } from "../config";
import type { ExecutionPlan, Quote } from "../types";
import type { V3Book } from "../venues/SaucerV3";
import { fakeFetch } from "../venues/testkit";
import type { V3Auth } from "../v3/auth";
import { MAX_UINT160 } from "../v3/onboarding";
import { assertMainnetAllowed, executeV3, OnboardingRequired, settlementIds } from "./v3";

const cfg = getConfig("mainnet");
const account = "0x00000000000000000000000000000000000000aa" as const;
const reactor = "0xa2c2713E82B47DCB3B0bae75199C81fcd185b86C" as const;
const permit2 = "0x8D53a86b10b503f284A0EA9e8316bc6081432A96" as const;
const domain = { name: "PartialFillLimitOrderReactor", version: "1", chainId: 295, verifyingContract: reactor };
const book: V3Book = {
  id: "2",
  baseTokenId: "0.0.731861",
  quoteTokenId: "0.0.456858",
  baseTokenEvmAddress: "0x00000000000000000000000000000000000b2ad5",
  quoteTokenEvmAddress: "0x000000000000000000000000000000000006f89a",
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
};
const q: Quote = {
  venue: "SAUCER_V3",
  bookId: "2",
  side: "SELL",
  amountIn: 100_000_000n,
  amountOut: 1_320_000n,
  fillable: true,
  minNotionalOk: true,
  fetchedAt: 0,
};
const plan: ExecutionPlan = {
  kind: "V3_MARKET",
  network: "mainnet",
  tokenIn: cfg.tokens.SAUCE!,
  tokenOut: cfg.tokens.USDC!,
  amountIn: 100_000_000n,
  totalOut: 1_320_000n,
  totalMinOut: 1_250_000n,
  slippageBps: 50,
  order: q,
  bestSingleVenue: q,
  alternatives: [q],
  planHash: "0xabc",
  createdAt: 0,
};
const auth = {
  withAuth: async (fn: (h: Record<string, string>) => Promise<unknown>) => fn({ Authorization: "Bearer t" }),
  authenticate: async () => "t",
} as unknown as V3Auth;
const far = BigInt(Math.floor(Date.now() / 1000) + 10_000);
const onboardedChain = {
  readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) =>
    functionName === "permit2"
      ? permit2
      : functionName === "allowance" && args?.length === 2
        ? MAX_UINT160
        : [MAX_UINT160, far, 0n],
} as unknown as PublicClient;
const apiOrder = {
  info: {
    reactor,
    swapper: account,
    nonce: "7",
    deadline: "1",
    additionalValidationContract: "0x0000000000000000000000000000000000000000",
    additionalValidationData: "0x",
  },
  input: { token: book.baseTokenEvmAddress, amount: "100000000" },
  output: { token: book.quoteTokenEvmAddress, amount: "1255000", recipient: account },
  makerOnly: false,
  takerOnce: true,
  maxTakerFeePips: 1200,
  maxMakerFeePips: 0,
};
const env = { ALLOW_MAINNET_EXECUTION: "true", MAINNET_MAX_NOTIONAL_USD: "20" };

// Specific paths first: fakeFetch matches on the first key the URL contains; overrides keep their position.
const routes = (over: Record<string, unknown> = {}) => ({
  "/books/2/quote/exact-input": {
    body: {
      outputToken: book.quoteTokenEvmAddress,
      snappedInputAmount: "100000000",
      consumedInputAmount: "100000000",
      expectedOutputAmount: "1322000",
      suggestedOutputAmount: "1255000",
      slippageBps: 500,
      fillable: true,
    },
  },
  "/signature/domain": { body: domain },
  "/accounts/": { body: { tokens: [{}] } },
  "/onboarding/2/status": { body: { isComplete: true, pendingSteps: [] } },
  "/orders/build": { body: { orders: [apiOrder] } },
  "/orders/save": { body: { orders: [{ info: { nonce: "7" }, meta: { id: 99, status: "OPEN" } }] } },
  "/orders/99/history": {
    body: {
      events: [
        { type: "ORDER_PLACED" },
        { type: "ORDER_FILLED", transactionHash: "0.0.5-1-2", filledInput: "100000000", filledOutput: "1310000" },
      ],
    },
  },
  "/books": { body: { orderbooks: [book] } },
  ...over,
});

describe("executeV3", () => {
  it("runs the full market-order flow and returns the settlement", async () => {
    const steps: string[] = [];
    const res = await executeV3(plan, {
      cfg,
      auth,
      publicClient: onboardedChain,
      account,
      sign: async () => "0x00ff",
      fetchImpl: fakeFetch(routes()),
      timeoutMs: 1000,
      onStep: s => steps.push(s),
      notionalUsd: 1.3,
      env,
    });
    expect(res).toEqual({
      kind: "V3_MARKET",
      planHash: "0xabc",
      txHashes: ["0.0.5-1-2"],
      filledIn: 100_000_000n,
      filledOut: 1_310_000n,
      refs: { orderId: "99", nonce: "7", bookId: "2" },
    });
    expect(steps).toEqual(["onboarding", "quote", "place", "saved", "terminal"]);
  });

  it("refuses when onboarding is missing, the quote fell below the floor, or the order did not fill", async () => {
    const notOnboarded = {
      readContract: async ({ functionName, args }: { functionName: string; args?: unknown[] }) =>
        functionName === "permit2" ? permit2 : args?.length === 2 ? 0n : [0n, 0n, 0n],
    } as unknown as PublicClient;
    const err = await executeV3(plan, {
      cfg,
      auth,
      publicClient: notOnboarded,
      account,
      sign: async () => "0x00",
      fetchImpl: fakeFetch(routes()),
      notionalUsd: 1,
      env,
    }).catch(e => e);
    expect(err).toBeInstanceOf(OnboardingRequired);
    expect(err.report.steps.filter((s: { done: boolean }) => !s.done).length).toBeGreaterThan(0);
    const low = fakeFetch(
      routes({
        "/books/2/quote/exact-input": {
          body: {
            outputToken: book.quoteTokenEvmAddress,
            snappedInputAmount: "100000000",
            consumedInputAmount: "100000000",
            expectedOutputAmount: "1000000",
            suggestedOutputAmount: "950000",
            slippageBps: 500,
            fillable: true,
          },
        },
      }),
    );
    await expect(
      executeV3(plan, {
        cfg,
        auth,
        publicClient: onboardedChain,
        account,
        sign: async () => "0x00",
        fetchImpl: low,
        notionalUsd: 1,
        env,
      }),
    ).rejects.toThrow(/below the plan floor/);
    const canceled = fakeFetch(routes({ "/orders/99/history": { body: { events: [{ type: "ORDER_CANCELED" }] } } }));
    await expect(
      executeV3(plan, {
        cfg,
        auth,
        publicClient: onboardedChain,
        account,
        sign: async () => "0x00",
        fetchImpl: canceled,
        notionalUsd: 1,
        env,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/ended with ORDER_CANCELED/);
    const noId = fakeFetch(routes({ "/orders/save": { body: { orders: [{ meta: { status: "REJECTED" } }] } } }));
    await expect(
      executeV3(plan, {
        cfg,
        auth,
        publicClient: onboardedChain,
        account,
        sign: async () => "0x00",
        fetchImpl: noId,
        notionalUsd: 1,
        env,
      }),
    ).rejects.toThrow(/no order id/);
    await expect(
      executeV3(
        { ...plan, kind: "ONCHAIN_SPLIT" },
        { cfg, auth, publicClient: onboardedChain, account, sign: async () => "0x00" },
      ),
    ).rejects.toThrow(/V3_MARKET/);
    await expect(
      executeV3(
        { ...plan, order: { ...q, bookId: "77" } },
        {
          cfg,
          auth,
          publicClient: onboardedChain,
          account,
          sign: async () => "0x00",
          fetchImpl: fakeFetch(routes()),
          notionalUsd: 1,
          env,
        },
      ),
    ).rejects.toThrow(/book 77 not found/);
  });

  it("guards mainnet with the flag and the notional cap", () => {
    expect(() => assertMainnetAllowed("testnet", undefined, {})).not.toThrow();
    expect(() => assertMainnetAllowed("mainnet", 1, {})).toThrow(/ALLOW_MAINNET_EXECUTION/);
    expect(() => assertMainnetAllowed("mainnet", undefined, env)).toThrow(/USD notional/);
    expect(() => assertMainnetAllowed("mainnet", 25, env)).toThrow(/exceeds MAINNET_MAX_NOTIONAL_USD=20/);
    expect(() => assertMainnetAllowed("mainnet", 5, env)).not.toThrow();
  });

  it("collects settlement ids from events and fills", () => {
    expect(
      settlementIds({ type: "ORDER_FILLED", txHash: "a" }, [
        { transactionId: "b" },
        { fills: [{ transactionHash: "c" }, { txHash: "a" }] },
      ]),
    ).toEqual(["a", "b", "c"]);
  });
});
