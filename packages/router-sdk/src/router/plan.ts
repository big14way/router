import { encodeAbiParameters, keccak256, stringify, toHex, type Address, type Hex } from "viem";
import type { NetworkConfig } from "../config";
import type { ExecutionPlan, OnchainVenue, Quote, RouteLeg, Token, VenueReport } from "../types";
import { minusBps } from "../units";
import { isAmm, rankQuotes, type Ranking } from "./rank";
import { splitAcrossAmms, type Requote, type SplitOptions, type SplitResult } from "./split";

export const DEFAULT_SLIPPAGE_BPS = 50;

export class NoRouteError extends Error {
  constructor(public readonly ranking: Ranking) {
    super(
      ranking.excluded.length
        ? `no executable route: ${ranking.excluded.map(e => `${e.quote.venue} (${e.reason})`).join("; ")}`
        : "no venue returned a quote for this pair",
    );
    this.name = "NoRouteError";
  }
}

export type PlanInput = {
  cfg: NetworkConfig;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  reports: VenueReport[];
  /** Needed to evaluate splits; omit to plan single-venue only. */
  requote?: Requote;
  slippageBps?: number;
  split?: SplitOptions;
  v3EdgeBps?: number;
  now?: () => number;
};

export type PlanOutcome = { plan: ExecutionPlan; ranking: Ranking; split?: SplitResult };

/**
 * Turn venue reports into an ExecutionPlan:
 * 1. rank quotes (venue rules, V3 5 bps edge, all-in basis);
 * 2. if two or more AMM routes are executable, grid-search a split and keep it only when it beats
 *    the best single venue;
 * 3. emit legs (on-chain) or the winning order (V3 / Lambdaplex) with `minOut` floors from slippage.
 * Invariant: `plan.totalOut >= plan.bestSingleVenue.amountOut`.
 */
export async function buildPlan(input: PlanInput): Promise<PlanOutcome> {
  const { cfg, tokenIn, tokenOut, amountIn } = input;
  const slippageBps = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const ranking = rankQuotes(input.reports, { v3EdgeBps: input.v3EdgeBps });
  const best = ranking.ranked[0];
  if (!best) throw new NoRouteError(ranking);
  const createdAt = (input.now ?? Date.now)();
  const base = {
    network: cfg.network,
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps,
    bestSingleVenue: best,
    alternatives: ranking.ranked,
    createdAt,
  };

  const ammRoutes = ranking.ranked.filter(q => isAmm(q.venue));
  let split: SplitResult | undefined;
  if (ammRoutes.length >= 2 && input.requote) {
    split = await splitAcrossAmms(ammRoutes, amountIn, input.requote, input.split);
  }

  const splitWins = split !== undefined && split.legs.length > 1 && split.totalOut > best.amountOut;
  if (splitWins || isAmm(best.venue)) {
    const legs: RouteLeg[] = (splitWins ? split!.legs : [{ route: best, amountIn, amountOut: best.amountOut }]).map(
      l => ({
        venue: onchainVenue(l.route),
        path: l.route.path!,
        amountIn: l.amountIn,
        amountOut: l.amountOut,
        minOut: minusBps(l.amountOut, slippageBps),
      }),
    );
    const totalOut = legs.reduce((s, l) => s + l.amountOut, 0n);
    const totalMinOut = minusBps(totalOut, slippageBps);
    const plan: ExecutionPlan = {
      ...base,
      kind: "ONCHAIN_SPLIT",
      legs,
      totalOut,
      totalMinOut,
      planHash: onchainPlanHash(ammTokenAddress(cfg, tokenIn), ammTokenAddress(cfg, tokenOut), legs, totalMinOut),
    };
    return { plan, ranking, split };
  }

  const kind = best.venue === "SAUCER_V3" ? "V3_MARKET" : "LAMBDAPLEX_MARKET";
  const totalMinOut = minusBps(best.amountOut, slippageBps);
  const plan: ExecutionPlan = {
    ...base,
    kind,
    order: best,
    amountIn: best.amountIn,
    totalOut: best.amountOut,
    totalMinOut,
    planHash: offchainPlanHash({
      kind,
      network: cfg.network,
      tokenIn: tokenIn.id,
      tokenOut: tokenOut.id,
      amountIn: best.amountIn,
      totalMinOut,
      route: best.bookId ?? best.symbol,
      side: best.side,
      createdAt,
    }),
  };
  return { plan, ranking, split };
}

const onchainVenue = (q: Quote): OnchainVenue => (q.venue === "SAUCER_V1" ? 0 : 1);
const ammTokenAddress = (cfg: NetworkConfig, t: Token): Address => (t.native ? cfg.tokens.WHBAR!.evm : t.evm);

export const LEG_ABI = {
  type: "tuple[]",
  components: [
    { name: "venue", type: "uint8" },
    { name: "path", type: "bytes" },
    { name: "amountIn", type: "uint256" },
    { name: "minOut", type: "uint256" },
  ],
} as const;

/** Encode a leg's path as RouterExecutor expects: V1 = abi.encode(address[]), V2 = packed bytes. */
export function encodeLegPath(leg: Pick<RouteLeg, "venue" | "path">): Hex {
  return leg.venue === 0 ? encodeAbiParameters([{ type: "address[]" }], [leg.path as Address[]]) : (leg.path as Hex);
}

/**
 * keccak256(abi.encode(tokenIn, tokenOut, Leg[] legs, totalMinOut)) — identical to what
 * RouterExecutor computes and emits in `RouteExecuted`, so a receipt can be matched to the log.
 */
export function onchainPlanHash(tokenIn: Address, tokenOut: Address, legs: RouteLeg[], totalMinOut: bigint): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, LEG_ABI, { type: "uint256" }],
      [
        tokenIn,
        tokenOut,
        legs.map(l => ({ venue: l.venue, path: encodeLegPath(l), amountIn: l.amountIn, minOut: l.minOut })),
        totalMinOut,
      ],
    ),
  );
}

/** keccak256 of the canonical (sorted-key, bigint-as-string) JSON of an off-chain order descriptor. */
export function offchainPlanHash(descriptor: Record<string, unknown>): Hex {
  const sorted = Object.fromEntries(Object.entries(descriptor).sort(([a], [b]) => (a < b ? -1 : 1)));
  return keccak256(toHex(stringify(sorted)));
}
