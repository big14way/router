import { describe, expect, it } from "vitest";
import type { Quote } from "../types";
import { gridPoints, splitAcrossAmms, splitAmounts, type Requote } from "./split";

/** Constant-product pool: out = r1 * x / (r0 + x). Different reserves make splitting worthwhile. */
const pool = (r0: bigint, r1: bigint) => (x: bigint) => (r1 * x) / (r0 + x);
const route = (
  venue: Quote["venue"],
  path: `0x${string}`,
  f: (x: bigint) => bigint,
  amountIn: bigint,
): Quote & { f: (x: bigint) => bigint } => ({
  venue,
  path: venue === "SAUCER_V1" ? [path, "0x0000000000000000000000000000000000000001" as `0x${string}`] : path,
  amountIn,
  amountOut: f(amountIn),
  fillable: true,
  minNotionalOk: true,
  fetchedAt: 0,
  f,
});
const requoteWith =
  (routes: Array<Quote & { f: (x: bigint) => bigint }>): Requote =>
  async (r, amt) =>
    routes.find(x => x.path === r.path)!.f(amt);

describe("splitAmounts / gridPoints", () => {
  it("sums exactly and absorbs rounding in the last non-zero leg", () => {
    expect(splitAmounts(1001n, [50, 50])).toEqual([500n, 501n]);
    expect(splitAmounts(10n, [100, 0])).toEqual([10n, 0n]);
    expect(splitAmounts(7n, [33, 33, 34])).toEqual([2n, 2n, 3n]);
  });
  it("enumerates the simplex", () => {
    expect(gridPoints(2, 5)).toHaveLength(21);
    expect(gridPoints(2, 25)).toEqual([
      [0, 100],
      [25, 75],
      [50, 50],
      [75, 25],
      [100, 0],
    ]);
    const three = gridPoints(3, 5);
    expect(three.every(w => w.reduce((s, x) => s + x, 0) === 100)).toBe(true);
    expect(three).toHaveLength(66);
  });
});

describe("splitAcrossAmms", () => {
  const amountIn = 1_000_000n;
  const a = route("SAUCER_V1", "0xA", pool(10_000_000n, 10_000_000n), amountIn);
  const b = route("SAUCER_V2", "0xB", pool(5_000_000n, 5_000_000n), amountIn);

  it("finds a split that beats either single route on uneven pools", async () => {
    const r = await splitAcrossAmms([a, b], amountIn, requoteWith([a, b]));
    expect(r.legs).toHaveLength(2);
    expect(r.totalOut).toBeGreaterThan(r.bestSingleOut);
    expect(r.legs.reduce((s, l) => s + l.amountIn, 0n)).toBe(amountIn);
    expect(r.requotes).toBeGreaterThan(0);
    expect(r.requotes).toBeLessThanOrEqual(38);
  });

  it("returns the single best route when only one route exists or amounts are tiny", async () => {
    const one = await splitAcrossAmms([a], amountIn, requoteWith([a]));
    expect(one.legs).toHaveLength(1);
    expect(one.totalOut).toBe(a.amountOut);
    const tiny = await splitAcrossAmms([a, b], 50n, requoteWith([a, b]));
    expect(tiny.legs).toHaveLength(1);
  });

  it("never returns worse than best single even when re-quotes fail or are worse", async () => {
    const failing: Requote = async () => undefined;
    const r = await splitAcrossAmms([a, b], amountIn, failing);
    expect(r.totalOut).toBe(a.amountOut);
    const worse: Requote = async () => 1n;
    expect((await splitAcrossAmms([a, b], amountIn, worse)).totalOut).toBe(a.amountOut);
    const throwing: Requote = async () => {
      throw new Error("rpc");
    };
    expect((await splitAcrossAmms([a, b], amountIn, throwing)).totalOut).toBe(a.amountOut);
  });

  it("dedupes identical routes, ignores non-AMM quotes and handles three routes", async () => {
    const c = route("SAUCER_V2", "0xC", pool(2_000_000n, 2_500_000n), amountIn);
    const v3: Quote = {
      venue: "SAUCER_V3",
      amountIn,
      amountOut: 10n ** 9n,
      fillable: true,
      minNotionalOk: true,
      fetchedAt: 0,
      bookId: "1",
    };
    const r = await splitAcrossAmms([a, { ...a }, b, c, v3], amountIn, requoteWith([a, b, c]), { stepPct: 10 });
    expect(r.legs.every(l => l.route.venue !== "SAUCER_V3")).toBe(true);
    expect(r.totalOut).toBeGreaterThanOrEqual(Math.max(Number(a.amountOut), Number(b.amountOut), Number(c.amountOut)));
    await expect(splitAcrossAmms([v3], amountIn, requoteWith([]))).rejects.toThrow(/no AMM route/);
  });
});
