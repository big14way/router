import { describe, expect, it } from "vitest";
import { ZERO_ADDRESS } from "../evm";
import { encodeV2Path, SaucerV2 } from "./SaucerV2";
import { addr, cfg, encAddress, encQuote, fakeClient, mirror404, SAUCE, USDC, WHBAR } from "./testkit";

const pools: Record<string, number[]> = {
  [`${WHBAR.evm}/${SAUCE.evm}`.toLowerCase()]: [3000],
  [`${WHBAR.evm}/${USDC.evm}`.toLowerCase()]: [1500, 3000],
};
const key = (a: string, b: string) =>
  [a, b]
    .map(x => x.toLowerCase())
    .sort()
    .join("/");
const hasPool = (a: string, b: string, fee: number) =>
  Object.entries(pools).some(([k, fees]) => k.split("/").sort().join("/") === key(a, b) && fees.includes(fee));

const client = fakeClient((_, fn, args) => {
  if (fn === "getPool")
    return encAddress(
      hasPool(args[0] as string, args[1] as string, Number(args[2])) ? addr(0x2000 + Number(args[2])) : ZERO_ADDRESS,
    );
  if (fn === "quoteExactInput") {
    const [path, amountIn] = args as [`0x${string}`, bigint];
    const hops = (path.length - 2 - 40) / 46;
    const fee = parseInt(path.slice(42, 48), 16);
    // lower fee tier → better price; each extra hop costs 10%
    const out = (amountIn * BigInt(100_000 - fee)) / 100_000n / 10n ** BigInt(hops - 1 ? 1 : 0);
    return encQuote(out, 90_000n * BigInt(hops));
  }
  return undefined;
});

describe("encodeV2Path", () => {
  it("packs token|fee3|token", () => {
    const p = encodeV2Path([{ tokenIn: WHBAR.evm, tokenOut: SAUCE.evm, fee: 3000 }]);
    expect(p).toBe(`${WHBAR.evm.toLowerCase()}000bb8${SAUCE.evm.slice(2).toLowerCase()}`);
    const two = encodeV2Path([
      { tokenIn: SAUCE.evm, tokenOut: WHBAR.evm, fee: 500 },
      { tokenIn: WHBAR.evm, tokenOut: USDC.evm, fee: 1500 },
    ]);
    expect(two.length).toBe(2 + 40 + 6 + 40 + 6 + 40);
    expect(two.slice(42, 48)).toBe("0001f4");
  });
});

describe("SaucerV2", () => {
  const v2 = new SaucerV2(cfg, [client], { fetchImpl: mirror404 });

  it("quotes every live fee tier on the direct pair, best first", async () => {
    const q = await v2.quoteExactInput(WHBAR, USDC, 1_000_000n);
    expect(q.map(x => x.fees)).toEqual([[1500], [3000]]);
    expect(q[0]!.amountOut).toBeGreaterThan(q[1]!.amountOut);
    expect(q[0]!.gasEstimate).toBe(90_000n);
    expect(q[0]!.path).toBe(encodeV2Path([{ tokenIn: WHBAR.evm, tokenOut: USDC.evm, fee: 1500 }]));
  });

  it("builds via-WHBAR two-hop routes when no direct pool exists", async () => {
    const q = await v2.quoteExactInput(SAUCE, USDC, 1_000_000n);
    expect(q.map(x => x.fees)).toEqual([
      [3000, 1500],
      [3000, 3000],
    ]);
    expect(q[0]!.detail?.hops).toBe(2);
    expect(await v2.canExecute(SAUCE, USDC)).toEqual({ ok: true });
  });

  it("reports no route when no tier has a pool", async () => {
    const other = { ...USDC, id: "0.0.999", evm: addr(999) };
    expect(await v2.quoteExactInput(other, SAUCE, 1n)).toEqual([]);
    expect((await v2.canExecute(other, SAUCE)).ok).toBe(false);
  });
});
