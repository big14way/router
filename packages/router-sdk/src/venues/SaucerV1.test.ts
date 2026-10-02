import { describe, expect, it } from "vitest";
import { ZERO_ADDRESS } from "../evm";
import { SaucerV1 } from "./SaucerV1";
import { addr, cfg, encAddress, encAmounts, fakeClient, mirror404, SAUCE, USDC, WHBAR } from "./testkit";

const pairs: Record<string, string> = {
  [`${WHBAR.evm}/${SAUCE.evm}`.toLowerCase()]: addr(0x1001),
  [`${WHBAR.evm}/${USDC.evm}`.toLowerCase()]: addr(0x1002),
};
const pairKey = (a: string, b: string) =>
  [a, b]
    .map(x => x.toLowerCase())
    .sort()
    .join("/");
const pairOf = (a: string, b: string) => {
  const hit = Object.entries(pairs).find(([k]) => k.split("/").sort().join("/") === pairKey(a, b));
  return (hit?.[1] ?? ZERO_ADDRESS) as `0x${string}`;
};

const client = fakeClient((to, fn, args) => {
  if (fn === "getPair") return encAddress(pairOf(args[0] as string, args[1] as string));
  if (fn === "getAmountsOut") {
    const [amountIn, path] = args as [bigint, string[]];
    // 1 WHBAR → 50 SAUCE direct; via-WHBAR hops halve each time
    return encAmounts(path.map((_, i) => (i === 0 ? amountIn : (amountIn * 50n) / 2n ** BigInt(i - 1) / 100n)));
  }
  return undefined;
});

describe("SaucerV1", () => {
  const v1 = new SaucerV1(cfg, [client], { now: () => 1234, fetchImpl: mirror404 });

  it("quotes the direct path when a pair exists", async () => {
    const q = await v1.quoteExactInput(WHBAR, SAUCE, 100_000_000n);
    expect(q).toHaveLength(1);
    expect(q[0]!.path).toEqual([WHBAR.evm, SAUCE.evm]);
    expect(q[0]!.amountOut).toBe(50_000_000n);
    expect(q[0]!.fillable).toBe(true);
    expect(q[0]!.fetchedAt).toBe(1234);
  });

  it("adds the via-WHBAR path and sorts best first", async () => {
    const q = await v1.quoteExactInput(SAUCE, USDC, 1_000_000n);
    // SAUCE/USDC has no direct pair; SAUCE→WHBAR→USDC exists
    expect(q).toHaveLength(1);
    expect(q[0]!.path).toEqual([SAUCE.evm, WHBAR.evm, USDC.evm]);
    expect(q[0]!.detail?.hops).toBe(2);
  });

  it("returns [] and a reason when no pair exists", async () => {
    const other = { ...USDC, id: "0.0.999", evm: addr(999) };
    expect(await v1.quoteExactInput(other, SAUCE, 1n)).toEqual([]);
    expect(await v1.canExecute(other, SAUCE)).toEqual({ ok: false, reason: "no V1 pair (direct or via WHBAR)" });
    expect(await v1.canExecute(WHBAR, SAUCE)).toEqual({ ok: true });
  });

  it("routes native HBAR through WHBAR and ignores zero / same-token input", async () => {
    const q = await v1.quoteExactInput(cfg.tokens.HBAR!, SAUCE, 100_000_000n);
    expect(q[0]!.path).toEqual([WHBAR.evm, SAUCE.evm]);
    expect(await v1.quoteExactInput(WHBAR, WHBAR, 1n)).toEqual([]);
    expect(await v1.quoteExactInput(WHBAR, SAUCE, 0n)).toEqual([]);
  });

  it("skips paths whose quote reverts", async () => {
    const reverting = fakeClient((_, fn, args) =>
      fn === "getPair" ? encAddress(pairOf(args[0] as string, args[1] as string)) : undefined,
    );
    const v = new SaucerV1(cfg, [reverting], { fetchImpl: mirror404 });
    expect(await v.quoteExactInput(WHBAR, SAUCE, 1n)).toEqual([]);
  });
});
