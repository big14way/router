import { describe, expect, it } from "vitest";
import { decodeFunctionData, type PublicClient } from "viem";
import { getConfig } from "../config";
import type { V3Book } from "../venues/SaucerV3";
import { fakeFetch } from "../venues/testkit";
import {
  checkOnboarding,
  erc20AllowanceAbi,
  fetchDomain,
  hip719Abi,
  MAX_UINT160,
  permit2Abi,
  runOnboarding,
  type OnboardingWallet,
  HTS_MAX_ALLOWANCE,
  maxAllowanceFor,
} from "./onboarding";

const cfg = getConfig("testnet");
const account = "0x00000000000000000000000000000000000000aa" as const;
const reactor = "0x5707B946EE64bD750A587261Ce36ec7024F3088B" as const;
const permit2 = "0x2e2C4f4277183F2BC5eb982CD4cD27C1fb01c6Ed" as const;
const domain = {
  name: "PartialFillLimitOrderReactor",
  version: "1",
  chainId: 296,
  verifyingContract: reactor,
} as const;
const book: V3Book = {
  id: "3",
  baseTokenId: "0.0.1183558",
  quoteTokenId: "0.0.5449",
  baseTokenEvmAddress: "0x0000000000000000000000000000000000120f46",
  quoteTokenEvmAddress: "0x0000000000000000000000000000000000001549",
  status: "OPEN",
  isAMMEnabled: 1,
  isMarketHalted: 1,
  baseTokenSymbol: "SAUCE",
  quoteTokenSymbol: "USDC",
  baseTokenDecimals: 6,
  quoteTokenDecimals: 6,
  tickStep: "0.00001",
  sizeStep: "0.1",
  lotSize: "100000",
  minNotional: "1",
};
const MAX256 = (1n << 256n) - 1n;

function chain(state: { erc20: Record<string, bigint>; p2: Record<string, [bigint, bigint]> }) {
  return {
    readContract: async ({
      functionName,
      args,
      address,
    }: {
      functionName: string;
      args?: unknown[];
      address: string;
    }) => {
      if (functionName === "permit2") return permit2;
      if (functionName === "allowance" && args?.length === 2) return state.erc20[address.toLowerCase()] ?? 0n;
      if (functionName === "allowance") {
        const [a, e] = state.p2[String(args![1]).toLowerCase()] ?? [0n, 0n];
        return [a, e, 0n];
      }
      throw new Error(`unexpected ${functionName}`);
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as PublicClient;
}

describe("V3 onboarding", () => {
  it("reports every missing step with the exact transaction to send", async () => {
    const fetchImpl = fakeFetch({
      "/accounts/": url => ({ body: { tokens: url.includes("token.id=0.0.1183558") ? [{}] : [] } }),
    });
    const r = await checkOnboarding({
      cfg,
      publicClient: chain({ erc20: {}, p2: {} }),
      account,
      book,
      domain,
      fetchImpl,
    });
    expect(r.permit2).toBe(permit2);
    expect(r.complete).toBe(false);
    expect(r.steps.map(s => [s.key, s.done])).toEqual([
      ["associateBaseToken", true],
      ["approveBaseTokenPermit2", false],
      ["approveBaseTokenReactor", false],
      ["associateQuoteToken", false],
      ["approveQuoteTokenPermit2", false],
      ["approveQuoteTokenReactor", false],
    ]);
    const assoc = r.steps.find(s => s.key === "associateQuoteToken")!.tx!;
    expect(assoc.to).toBe(book.quoteTokenEvmAddress);
    expect(decodeFunctionData({ abi: hip719Abi, data: assoc.data }).functionName).toBe("associate");
    const p2 = decodeFunctionData({ abi: erc20AllowanceAbi, data: r.steps[1]!.tx!.data });
    expect(p2.functionName).toBe("approve");
    expect(p2.args?.[0]).toBe(permit2);
    expect(p2.args?.[1]).toBe(HTS_MAX_ALLOWANCE); // int64 ceiling when the supply is infinite
    const re = decodeFunctionData({ abi: permit2Abi, data: r.steps[2]!.tx!.data });
    expect(re.functionName).toBe("approve");
    expect(re.args?.[0]).toBe(book.baseTokenEvmAddress);
    expect(re.args?.[1]).toBe(reactor);
    expect(re.args?.[2]).toBe(MAX_UINT160);
  });

  it("caps the Permit2 approval at a finite token's max supply (HTS code 289)", async () => {
    const fetchImpl = fakeFetch({
      "/accounts/": { body: { tokens: [{}] } },
      "/tokens/0.0.1183558": { body: { supply_type: "FINITE", max_supply: "1000000000000000" } },
      "/tokens/": { body: { supply_type: "INFINITE", max_supply: "0" } },
    });
    const r = await checkOnboarding({
      cfg,
      publicClient: chain({ erc20: {}, p2: {} }),
      account,
      book,
      domain,
      fetchImpl,
    });
    const base = decodeFunctionData({
      abi: erc20AllowanceAbi,
      data: r.steps.find(s => s.key === "approveBaseTokenPermit2")!.tx!.data,
    });
    expect(base.args?.[1]).toBe(1000000000000000n);
    const quote = decodeFunctionData({
      abi: erc20AllowanceAbi,
      data: r.steps.find(s => s.key === "approveQuoteTokenPermit2")!.tx!.data,
    });
    expect(quote.args?.[1]).toBe(HTS_MAX_ALLOWANCE);
    expect(await maxAllowanceFor(cfg, "0.0.0", fetchImpl)).toBe((1n << 256n) - 1n);
    // a partly used allowance still counts as done while it covers the next order (fills consume allowance)
    const used = await checkOnboarding({
      cfg,
      publicClient: chain({ erc20: { [book.baseTokenEvmAddress]: 999_989_980_000n }, p2: {} }),
      account,
      book,
      domain,
      fetchImpl,
      required: 10_020_001n,
    });
    expect(used.steps.find(s => s.key === "approveBaseTokenPermit2")!.done).toBe(true);
    const tooLow = await checkOnboarding({
      cfg,
      publicClient: chain({ erc20: { [book.baseTokenEvmAddress]: 5n }, p2: {} }),
      account,
      book,
      domain,
      fetchImpl,
      required: 10_020_001n,
    });
    expect(tooLow.steps.find(s => s.key === "approveBaseTokenPermit2")!.done).toBe(false);
    // an allowance at the cap counts as done
    const capped = await checkOnboarding({
      cfg,
      publicClient: chain({ erc20: { [book.baseTokenEvmAddress]: 1000000000000000n }, p2: {} }),
      account,
      book,
      domain,
      fetchImpl,
    });
    expect(capped.steps.find(s => s.key === "approveBaseTokenPermit2")!.done).toBe(true);
  });

  it("is complete when chain state has everything, treats HBAR as pre-approved, and includes the API view", async () => {
    const far = BigInt(Math.floor(Date.now() / 1000) + 10_000);
    const state = {
      erc20: { [book.baseTokenEvmAddress]: HTS_MAX_ALLOWANCE, [book.quoteTokenEvmAddress]: MAX256 },
      p2: {
        [book.baseTokenEvmAddress]: [MAX_UINT160, far] as [bigint, bigint],
        [book.quoteTokenEvmAddress]: [MAX_UINT160, far] as [bigint, bigint],
      },
    };
    const fetchImpl = fakeFetch({
      "/accounts/": { body: { tokens: [{}] } },
      "/onboarding/3/status": { body: { isComplete: true, pendingSteps: [] } },
      "/signature/domain": { body: domain },
    });
    const auth = {
      withAuth: async (fn: (h: Record<string, string>) => Promise<unknown>) => fn({ Authorization: "Bearer t" }),
    } as never;
    const r = await checkOnboarding({ cfg, publicClient: chain(state), account, book, domain, fetchImpl, auth });
    expect(r.complete).toBe(true);
    expect(r.api).toEqual({ isComplete: true, pendingSteps: [] });
    const hbarBook = {
      ...book,
      baseTokenId: "0.0.0",
      baseTokenEvmAddress: "0x0000000000000000000000000000000000000000",
    };
    const r2 = await checkOnboarding({ cfg, publicClient: chain(state), account, book: hbarBook, domain, fetchImpl });
    expect(r2.steps.slice(0, 3).every(s => s.done)).toBe(true);
    const expired = {
      ...state,
      p2: { ...state.p2, [book.baseTokenEvmAddress]: [MAX_UINT160, 1n] as [bigint, bigint] },
    };
    expect(
      (await checkOnboarding({ cfg, publicClient: chain(expired), account, book, domain, fetchImpl })).steps[2]!.done,
    ).toBe(false);
    expect(await fetchDomain(cfg, fetchImpl)).toEqual(domain);
    const apiDown = {
      withAuth: async () => {
        throw new Error("down");
      },
    } as never;
    expect(
      (await checkOnboarding({ cfg, publicClient: chain(state), account, book, domain, fetchImpl, auth: apiDown })).api,
    ).toBeUndefined();
  });

  it("runs the missing steps and re-verifies on chain after each", async () => {
    const state = { erc20: {} as Record<string, bigint>, p2: {} as Record<string, [bigint, bigint]> };
    const associated = new Set<string>(["0.0.1183558"]);
    const fetchImpl = fakeFetch({
      "/accounts/": url => ({
        body: { tokens: [...associated].some(id => url.includes(`token.id=${id}`)) ? [{}] : [] },
      }),
    });
    const sent: string[] = [];
    const walletClient: OnboardingWallet = {
      account: { address: account },
      sendTransaction: async tx => {
        sent.push(tx.to);
        const far = BigInt(Math.floor(Date.now() / 1000) + 10_000);
        if (tx.to.toLowerCase() === permit2.toLowerCase()) {
          const d = decodeFunctionData({ abi: permit2Abi, data: tx.data });
          state.p2[String(d.args![0]).toLowerCase()] = [MAX_UINT160, far];
        } else if (tx.data.startsWith("0x095ea7b3")) state.erc20[tx.to.toLowerCase()] = HTS_MAX_ALLOWANCE;
        else associated.add("0.0.5449");
        return `0x${sent.length.toString(16).padStart(64, "0")}` as `0x${string}`;
      },
    };
    const steps: string[] = [];
    const r = await runOnboarding({
      cfg,
      publicClient: chain(state),
      account,
      book,
      domain,
      fetchImpl,
      walletClient,
      onStep: s => steps.push(s.key),
    });
    expect(r.complete).toBe(true);
    expect(steps).toEqual([
      "approveBaseTokenPermit2",
      "approveBaseTokenReactor",
      "associateQuoteToken",
      "approveQuoteTokenPermit2",
      "approveQuoteTokenReactor",
    ]);
    const stuck: OnboardingWallet = {
      account: { address: account },
      sendTransaction: async () => "0x01" as `0x${string}`,
    };
    await expect(
      runOnboarding({
        cfg,
        publicClient: chain({ erc20: {}, p2: {} }),
        account,
        book,
        domain,
        fetchImpl: fakeFetch({ "/accounts/": { body: { tokens: [] } } }),
        walletClient: stuck,
      }),
    ).rejects.toThrow(/did not take effect/);
  });
});
