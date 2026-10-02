import type { Hex } from "viem";
import type { ExecutionPlan, Network, PlanKind, Quote, RouteLeg, VenueName } from "../types";

/** Best-execution receipt, version 1. Published to HCS as JSON; all bigints are decimal strings. */
export type Receipt = {
  v: 1;
  planHash: Hex;
  net: Network;
  kind: PlanKind;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** Every venue quote that was considered, best first. */
  quotes: ReceiptQuote[];
  /** Winning venue (or "SPLIT" for a multi-leg on-chain plan). */
  selected: VenueName | "SPLIT";
  legs?: { venue: 0 | 1; path: string; amountIn: string; minOut: string }[];
  order?: { venue: VenueName; bookId?: string; symbol?: string; side?: string; amountIn: string; amountOut: string };
  /** EVM transaction hashes (on-chain) or Hedera transaction IDs (V3 / Lambdaplex settlement). */
  txHashes?: string[];
  settlementTxIds?: string[];
  filledIn?: string;
  filledOut?: string;
  /** Account the execution was done by (EVM address for on-chain, 0.0.x for off-chain). */
  account?: string;
  ts: number;
};

export type ReceiptQuote = { venue: VenueName; amountOut: string; fillable: boolean; route?: string };

export function receiptFromPlan(
  plan: ExecutionPlan,
  fill: {
    txHashes?: string[];
    settlementTxIds?: string[];
    filledIn?: bigint | string;
    filledOut?: bigint | string;
    account?: string;
  },
  ts = Date.now(),
): Receipt {
  const routeOf = (q: Quote): string | undefined =>
    q.venue === "SAUCER_V1"
      ? (q.path as string[]).join(">")
      : q.venue === "SAUCER_V2"
        ? String(q.path)
        : q.venue === "SAUCER_V3"
          ? `book ${q.bookId} ${q.side}`
          : `${q.symbol} ${q.side}`;
  const legs: RouteLeg[] | undefined = plan.legs;
  return {
    v: 1,
    planHash: plan.planHash,
    net: plan.network,
    kind: plan.kind,
    tokenIn: plan.tokenIn.id,
    tokenOut: plan.tokenOut.id,
    amountIn: plan.amountIn.toString(),
    quotes: plan.alternatives.map(q => ({
      venue: q.venue,
      amountOut: q.amountOut.toString(),
      fillable: q.fillable,
      route: routeOf(q),
    })),
    selected:
      legs && legs.length > 1 ? "SPLIT" : legs ? (legs[0]!.venue === 0 ? "SAUCER_V1" : "SAUCER_V2") : plan.order!.venue,
    legs: legs?.map(l => ({
      venue: l.venue,
      path: Array.isArray(l.path) ? l.path.join(">") : String(l.path),
      amountIn: l.amountIn.toString(),
      minOut: l.minOut.toString(),
    })),
    order: plan.order
      ? {
          venue: plan.order.venue,
          bookId: plan.order.bookId,
          symbol: plan.order.symbol,
          side: plan.order.side,
          amountIn: plan.order.amountIn.toString(),
          amountOut: plan.order.amountOut.toString(),
        }
      : undefined,
    txHashes: fill.txHashes,
    settlementTxIds: fill.settlementTxIds,
    filledIn: fill.filledIn?.toString(),
    filledOut: fill.filledOut?.toString(),
    account: fill.account,
    ts,
  };
}
