import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, toHex, type PublicClient, type WalletClient } from "viem";
import { getConfig } from "../config";
import type { ExecutionPlan, Quote } from "../types";
import { fakeFetch } from "../venues/testkit";
import { executeOnchain, parseRouteExecuted, preflightOnchain, prepareOnchain } from "./onchain";

const cfg = getConfig("testnet");
const WHBAR = cfg.tokens.WHBAR!;
const HBAR = cfg.tokens.HBAR!;
const SAUCE = cfg.tokens.SAUCE!;
const user = "0x00000000000000000000000000000000000000aa" as const;
const executor = "0x00000000000000000000000000000000000000ee" as const;
const q: Quote = {
  venue: "SAUCER_V1",
  path: [WHBAR.evm, SAUCE.evm],
  amountIn: 100n,
  amountOut: 50n,
  fillable: true,
  minNotionalOk: true,
  fetchedAt: 0,
};
const planHash = keccak256("0x01");
const plan: ExecutionPlan = {
  kind: "ONCHAIN_SPLIT",
  network: "testnet",
  tokenIn: HBAR,
  tokenOut: SAUCE,
  amountIn: 100n,
  totalOut: 50n,
  totalMinOut: 49n,
  slippageBps: 50,
  legs: [{ venue: 0, path: [WHBAR.evm, SAUCE.evm], amountIn: 100n, amountOut: 50n, minOut: 49n }],
  bestSingleVenue: q,
  alternatives: [q],
  planHash,
  createdAt: 0,
};
const topic0 = keccak256(toHex("RouteExecuted(address,address,address,uint256,uint256,bytes32)"));
const logFor = (hash: `0x${string}`, totalOut: bigint) => ({
  topics: [
    topic0,
    `0x${"00".repeat(12)}${user.slice(2)}`,
    `0x${"00".repeat(12)}${WHBAR.evm.slice(2)}`,
    `0x${"00".repeat(12)}${SAUCE.evm.slice(2)}`,
  ] as `0x${string}`[],
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [100n, totalOut, hash]),
});

function clients(
  opts: { allowance?: bigint; logs?: ReturnType<typeof logFor>[]; status?: "success" | "reverted" } = {},
) {
  const writes: { functionName: string; value?: bigint; args?: unknown[] }[] = [];
  const publicClient = {
    readContract: async () => opts.allowance ?? 0n,
    waitForTransactionReceipt: async () => ({
      status: opts.status ?? "success",
      logs: opts.logs ?? [logFor(planHash, 50n)],
    }),
  } as unknown as PublicClient;
  const walletClient = {
    account: { address: user },
    chain: undefined,
    writeContract: async (p: { functionName: string; value?: bigint; args?: unknown[] }) => {
      writes.push(p);
      return `0x${writes.length.toString(16).padStart(64, "0")}` as `0x${string}`;
    },
  } as unknown as WalletClient;
  return { publicClient, walletClient, writes };
}

describe("on-chain executor", () => {
  it("pre-flight reads association from the mirror and allowance from chain", async () => {
    const { publicClient, walletClient } = clients({ allowance: 5n });
    const fetchImpl = fakeFetch({ "/tokens?token.id=": { body: { tokens: [] } } });
    const pre = await preflightOnchain(plan, { cfg, executor, publicClient, walletClient, fetchImpl });
    expect(pre).toEqual({ associated: false, allowance: 100n, needsApproval: false, hbarIn: true, unwrap: false });
    const tokenPlan = { ...plan, tokenIn: WHBAR };
    const pre2 = await preflightOnchain(tokenPlan, {
      cfg,
      executor,
      publicClient,
      walletClient,
      fetchImpl: fakeFetch({ "/tokens?token.id=": { body: { tokens: [{}] } } }),
    });
    expect(pre2).toMatchObject({ associated: true, allowance: 5n, needsApproval: true, hbarIn: false });
  });

  it("prepare runs associate and approve only when needed", async () => {
    const { publicClient, walletClient, writes } = clients({ allowance: 0n });
    const steps: string[] = [];
    const pre = await prepareOnchain(
      { ...plan, tokenIn: WHBAR },
      {
        cfg,
        executor,
        publicClient,
        walletClient,
        fetchImpl: fakeFetch({ "/tokens?token.id=": { body: { tokens: [] } } }),
        onStep: s => steps.push(s),
      },
    );
    expect(writes.map(w => w.functionName)).toEqual(["associate", "approve"]);
    expect(steps).toEqual(["associate", "approve"]);
    expect(pre.needsApproval).toBe(false);
    const ready = clients({ allowance: 10n ** 9n });
    await prepareOnchain(
      { ...plan, tokenIn: WHBAR },
      {
        cfg,
        executor,
        publicClient: ready.publicClient,
        walletClient: ready.walletClient,
        fetchImpl: fakeFetch({ "/tokens?token.id=": { body: { tokens: [{}] } } }),
      },
    );
    expect(ready.writes).toHaveLength(0);
  });

  it("executes with HBAR as weibar value and returns the fill from RouteExecuted", async () => {
    const { publicClient, walletClient, writes } = clients();
    const res = await executeOnchain(plan, { cfg, executor, publicClient, walletClient });
    expect(writes[0]!.functionName).toBe("executeSplit");
    expect(writes[0]!.value).toBe(100n * 10n ** 10n);
    const args = writes[0]!.args as unknown[];
    expect(args[0]).toBe(WHBAR.evm); // HBAR in → WHBAR address on chain
    expect(args[6]).toBe(false);
    expect(res).toMatchObject({ kind: "ONCHAIN_SPLIT", planHash, filledIn: 100n, filledOut: 50n });
    expect(res.txHashes).toHaveLength(1);
  });

  it("rejects wrong kinds, reverts, missing logs and hash mismatches", async () => {
    await expect(executeOnchain({ ...plan, kind: "V3_MARKET" }, { cfg, executor, ...clients() })).rejects.toThrow(
      /ONCHAIN_SPLIT/,
    );
    await expect(executeOnchain(plan, { cfg, executor, ...clients({ status: "reverted" }) })).rejects.toThrow(
      /reverted/,
    );
    await expect(executeOnchain(plan, { cfg, executor, ...clients({ logs: [] }) })).rejects.toThrow(
      /RouteExecuted log not found/,
    );
    await expect(
      executeOnchain(plan, { cfg, executor, ...clients({ logs: [logFor(keccak256("0x02"), 50n)] }) }),
    ).rejects.toThrow(/planHash mismatch/);
    const mainnet = { ...plan, network: "mainnet" as const };
    await expect(executeOnchain(mainnet, { cfg: getConfig("mainnet"), executor, ...clients() })).rejects.toThrow(
      /ALLOW_MAINNET_EXECUTION/,
    );
    expect(parseRouteExecuted([{ data: "0x", topics: [] }])).toBeUndefined();
  });
});
