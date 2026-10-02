import type { Quote } from "../types";
import { byOutDesc, isAmm, routeKey } from "./rank";

/** Re-quote a specific route for a different input size. `undefined` when the route cannot fill it. */
export type Requote = (route: Quote, amountIn: bigint) => Promise<bigint | undefined>;

export type SplitLeg = { route: Quote; amountIn: bigint; amountOut: bigint };

export type SplitResult = {
  legs: SplitLeg[];
  totalOut: bigint;
  /** Output of the best single route at full size (the bar every split must clear). */
  bestSingleOut: bigint;
  /** Number of re-quotes performed. */
  requotes: number;
};

export type SplitOptions = {
  /** Grid resolution in percent (default 5 → 21 points per pair). */
  stepPct?: number;
  /** How many AMM routes to consider (default 3; at most the top 3 are used). */
  maxRoutes?: number;
  /** Parallelism for re-quotes (default 4; public relays are rate limited). */
  concurrency?: number;
};

/**
 * Grid-search a split across the top on-chain AMM routes. Candidate routes are distinct V1/V2 routes
 * (a V1 path and a V2 pool are independent liquidity, so splitting between them can beat either).
 * Every grid point is re-quoted at its exact size. The result is never worse than the best single
 * route: the 100/0 points are part of the grid and the full-size quote is the fallback.
 */
export async function splitAcrossAmms(
  quotes: Quote[],
  amountIn: bigint,
  requote: Requote,
  opts: SplitOptions = {},
): Promise<SplitResult> {
  const step = opts.stepPct ?? 5;
  const maxRoutes = Math.min(opts.maxRoutes ?? 3, 3);
  const routes = dedupeRoutes(quotes.filter(q => isAmm(q.venue) && q.fillable && q.amountOut > 0n)).slice(0, maxRoutes);
  if (!routes.length) throw new Error("no AMM route to split across");
  const best = routes[0]!;
  const single: SplitResult = {
    legs: [{ route: best, amountIn, amountOut: best.amountOut }],
    totalOut: best.amountOut,
    bestSingleOut: best.amountOut,
    requotes: 0,
  };
  if (routes.length === 1 || amountIn < 100n) return single;

  const cache = new Map<string, bigint | undefined>();
  let requotes = 0;
  const q = async (route: Quote, amt: bigint): Promise<bigint | undefined> => {
    if (amt === 0n) return 0n;
    if (amt === amountIn) return route.amountOut;
    const key = `${routeKey(route)}@${amt}`;
    if (cache.has(key)) return cache.get(key);
    requotes += 1;
    const out = await requote(route, amt).catch(() => undefined);
    cache.set(key, out);
    return out;
  };

  const points = gridPoints(routes.length, step);
  let winner = single;
  const concurrency = opts.concurrency ?? 4;
  for (let i = 0; i < points.length; i += concurrency) {
    const batch = points.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async weights => evaluate(routes, weights, amountIn, q)));
    for (const r of results) if (r && r.totalOut > winner.totalOut) winner = r;
  }
  return { ...winner, bestSingleOut: best.amountOut, requotes };
}

async function evaluate(
  routes: Quote[],
  weightsPct: number[],
  amountIn: bigint,
  q: (route: Quote, amt: bigint) => Promise<bigint | undefined>,
): Promise<SplitResult | undefined> {
  const amounts = splitAmounts(amountIn, weightsPct);
  const outs = await Promise.all(routes.map((r, i) => q(r, amounts[i]!)));
  if (outs.some(o => o === undefined)) return undefined;
  const legs: SplitLeg[] = routes
    .map((route, i) => ({ route, amountIn: amounts[i]!, amountOut: outs[i]! }))
    .filter(l => l.amountIn > 0n);
  const totalOut = legs.reduce((s, l) => s + l.amountOut, 0n);
  return { legs, totalOut, bestSingleOut: 0n, requotes: 0 };
}

/** Integer amounts for percentage weights; the last non-zero leg absorbs rounding so the sum is exact. */
export function splitAmounts(amountIn: bigint, weightsPct: number[]): bigint[] {
  const amounts = weightsPct.map(w => (amountIn * BigInt(w)) / 100n);
  const rest = amountIn - amounts.reduce((s, a) => s + a, 0n);
  const last =
    weightsPct
      .map((w, i) => (w > 0 ? i : -1))
      .filter(i => i >= 0)
      .pop() ?? 0;
  amounts[last] = (amounts[last] ?? 0n) + rest;
  return amounts;
}

/** All weight vectors (percent) on a simplex with the given step; three routes use a coarser 10% step. */
export function gridPoints(n: number, stepPct: number): number[][] {
  if (n === 2) {
    const out: number[][] = [];
    for (let a = 0; a <= 100; a += stepPct) out.push([a, 100 - a]);
    return out;
  }
  const step = Math.max(stepPct, 10);
  const out: number[][] = [];
  for (let a = 0; a <= 100; a += step) for (let b = 0; a + b <= 100; b += step) out.push([a, b, 100 - a - b]);
  return out;
}

function dedupeRoutes(quotes: Quote[]): Quote[] {
  const seen = new Set<string>();
  return quotes.sort(byOutDesc).filter(q => {
    const k = routeKey(q);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
