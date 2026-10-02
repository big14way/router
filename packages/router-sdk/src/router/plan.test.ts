import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";
import { getConfig } from "../config";
import type { Quote, VenueReport } from "../types";
import { buildPlan, encodeLegPath, NoRouteError, offchainPlanHash, onchainPlanHash } from "./plan";
import type { Requote } from "./split";

const cfg = getConfig("testnet");
const WHBAR = cfg.tokens.WHBAR!;
const SAUCE = cfg.tokens.SAUCE!;
const HBAR = cfg.tokens.HBAR!;
const pool = (r0: bigint, r1: bigint) => (x: bigint) => (r1 * x) / (r0 + x);
const rep = (venue: Quote["venue"], quotes: Quote[], ok = true, reason?: string): VenueReport => ({
  venue,
  status: { ok, reason },
  quotes,
  latencyMs: 0,
});

const amountIn = 10n ** 9n;
const fA = pool(10n ** 11n, 5n * 10n ** 10n);
const fB = pool(10n ** 10n, 5n * 10n ** 9n);
const v1: Quote = {
  venue: "SAUCER_V1",
  path: [WHBAR.evm, SAUCE.evm],
  amountIn,
  amountOut: fA(amountIn),
  fillable: true,
  minNotionalOk: true,
  fetchedAt: 0,
};
const v2: Quote = {
  venue: "SAUCER_V2",
  path: `${WHBAR.evm}000bb8${SAUCE.evm.slice(2)}` as `0x${string}`,
  fees: [3000],
  amountIn,
  amountOut: fB(amountIn),
  fillable: true,
  minNotionalOk: true,
  fetchedAt: 0,
};
const requote: Requote = async (r, amt) => (r.venue === "SAUCER_V1" ? fA(amt) : fB(amt));

describe("buildPlan", () => {
  it("emits an on-chain split that beats the best single venue, with minOut floors", async () => {
    const { plan, split } = await buildPlan({
      cfg,
      tokenIn: HBAR,
      tokenOut: SAUCE,
      amountIn,
      reports: [rep("SAUCER_V1", [v1]), rep("SAUCER_V2", [v2])],
      requote,
      now: () => 42,
    });
    expect(plan.kind).toBe("ONCHAIN_SPLIT");
    expect(plan.legs!.length).toBe(2);
    expect(plan.totalOut).toBeGreaterThan(plan.bestSingleVenue.amountOut);
    expect(plan.totalOut).toBe(split!.totalOut);
    expect(plan.legs!.reduce((s, l) => s + l.amountIn, 0n)).toBe(amountIn);
    for (const l of plan.legs!) expect(l.minOut).toBe(l.amountOut - (l.amountOut * 50n) / 10_000n);
    expect(plan.totalMinOut).toBe(plan.totalOut - (plan.totalOut * 50n) / 10_000n);
    expect(plan.planHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(plan.createdAt).toBe(42);
    expect(plan.alternatives.length).toBe(2);
  });

  it("falls back to a single on-chain leg when the split does not win or no requote is given", async () => {
    const same: Quote = { ...v2, amountOut: 1n };
    const { plan } = await buildPlan({
      cfg,
      tokenIn: WHBAR,
      tokenOut: SAUCE,
      amountIn,
      reports: [rep("SAUCER_V1", [v1]), rep("SAUCER_V2", [same])],
      requote: async () => 1n,
    });
    expect(plan.legs).toHaveLength(1);
    expect(plan.legs![0]!.venue).toBe(0);
    expect(plan.totalOut).toBe(v1.amountOut);
    const noReq = await buildPlan({
      cfg,
      tokenIn: WHBAR,
      tokenOut: SAUCE,
      amountIn,
      reports: [rep("SAUCER_V1", [v1]), rep("SAUCER_V2", [v2])],
    });
    expect(noReq.plan.legs).toHaveLength(1);
    expect(noReq.split).toBeUndefined();
  });

  it("emits V3_MARKET / LAMBDAPLEX_MARKET plans for off-chain winners", async () => {
    const v3: Quote = {
      venue: "SAUCER_V3",
      bookId: "2",
      side: "SELL",
      amountIn: amountIn - 7n,
      amountOut: v1.amountOut * 2n,
      fillable: true,
      minNotionalOk: true,
      fetchedAt: 0,
      snappedInputAmount: amountIn - 7n,
    };
    const { plan } = await buildPlan({
      cfg,
      tokenIn: HBAR,
      tokenOut: SAUCE,
      amountIn,
      reports: [rep("SAUCER_V1", [v1]), rep("SAUCER_V3", [v3])],
      requote,
      slippageBps: 100,
    });
    expect(plan.kind).toBe("V3_MARKET");
    expect(plan.order).toBe(v3);
    expect(plan.amountIn).toBe(amountIn - 7n);
    expect(plan.totalMinOut).toBe(v3.amountOut - v3.amountOut / 100n);
    expect(plan.legs).toBeUndefined();
    const lp: Quote = {
      venue: "LAMBDAPLEX",
      symbol: "HBAR-USDC",
      side: "SELL",
      amountIn,
      amountOut: v1.amountOut * 3n,
      fillable: true,
      minNotionalOk: true,
      fetchedAt: 0,
    };
    const lpPlan = await buildPlan({
      cfg,
      tokenIn: HBAR,
      tokenOut: SAUCE,
      amountIn,
      reports: [rep("LAMBDAPLEX", [lp])],
    });
    expect(lpPlan.plan.kind).toBe("LAMBDAPLEX_MARKET");
    expect(lpPlan.plan.planHash).not.toBe(plan.planHash);
  });

  it("throws NoRouteError with reasons when nothing is executable", async () => {
    const err = await buildPlan({
      cfg,
      tokenIn: HBAR,
      tokenOut: SAUCE,
      amountIn,
      reports: [rep("SAUCER_V3", [{ ...v1, venue: "SAUCER_V3" }], false, "halted")],
    }).catch(e => e);
    expect(err).toBeInstanceOf(NoRouteError);
    expect(err.message).toContain("SAUCER_V3 (halted)");
    const empty = await buildPlan({ cfg, tokenIn: HBAR, tokenOut: SAUCE, amountIn, reports: [] }).catch(e => e);
    expect(empty.message).toBe("no venue returned a quote for this pair");
  });

  it("property: plan total is never below the best single venue (random pools and sizes)", async () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 40; i += 1) {
      const r0a = BigInt(Math.floor(rnd() * 1e9) + 1e6),
        r1a = BigInt(Math.floor(rnd() * 1e9) + 1e6);
      const r0b = BigInt(Math.floor(rnd() * 1e9) + 1e6),
        r1b = BigInt(Math.floor(rnd() * 1e9) + 1e6);
      const amt = BigInt(Math.floor(rnd() * 1e8) + 100);
      const ga = pool(r0a, r1a),
        gb = pool(r0b, r1b);
      const qa = { ...v1, amountIn: amt, amountOut: ga(amt) };
      const qb = { ...v2, amountIn: amt, amountOut: gb(amt) };
      const flaky: Requote = async (r, a) => (rnd() < 0.2 ? undefined : r.venue === "SAUCER_V1" ? ga(a) : gb(a));
      const { plan } = await buildPlan({
        cfg,
        tokenIn: WHBAR,
        tokenOut: SAUCE,
        amountIn: amt,
        reports: [rep("SAUCER_V1", [qa]), rep("SAUCER_V2", [qb])],
        requote: flaky,
        split: { stepPct: 10 },
      });
      expect(plan.totalOut >= plan.bestSingleVenue.amountOut).toBe(true);
      expect(plan.legs!.reduce((s, l) => s + l.amountIn, 0n)).toBe(amt);
    }
  });
});

describe("plan hashes", () => {
  it("encodes V1 paths as abi address[] and V2 paths raw", () => {
    expect(encodeLegPath({ venue: 0, path: [WHBAR.evm, SAUCE.evm] })).toBe(
      encodeAbiParameters([{ type: "address[]" }], [[WHBAR.evm, SAUCE.evm]]),
    );
    expect(encodeLegPath({ venue: 1, path: "0xdeadbeef" })).toBe("0xdeadbeef");
  });
  it("is deterministic and sensitive to every field", () => {
    const legs = [{ venue: 0 as const, path: [WHBAR.evm, SAUCE.evm], amountIn: 1n, amountOut: 2n, minOut: 1n }];
    const h = onchainPlanHash(WHBAR.evm, SAUCE.evm, legs, 1n);
    expect(h).toBe(onchainPlanHash(WHBAR.evm, SAUCE.evm, legs, 1n));
    expect(h).not.toBe(onchainPlanHash(WHBAR.evm, SAUCE.evm, legs, 2n));
    expect(h).toBe(
      keccak256(
        encodeAbiParameters(
          [
            { type: "address" },
            { type: "address" },
            {
              type: "tuple[]",
              components: [
                { name: "venue", type: "uint8" },
                { name: "path", type: "bytes" },
                { name: "amountIn", type: "uint256" },
                { name: "minOut", type: "uint256" },
              ],
            },
            { type: "uint256" },
          ],
          [WHBAR.evm, SAUCE.evm, [{ venue: 0, path: encodeLegPath(legs[0]!), amountIn: 1n, minOut: 1n }], 1n],
        ),
      ),
    );
    expect(offchainPlanHash({ b: 1n, a: "x" })).toBe(offchainPlanHash({ a: "x", b: 1n }));
    expect(offchainPlanHash({ a: 1n })).not.toBe(offchainPlanHash({ a: 2n }));
  });
});
