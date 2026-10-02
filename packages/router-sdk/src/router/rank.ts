import { V3_EDGE_BPS } from "../config";
import type { Quote, VenueName, VenueReport } from "../types";
import { applyBps } from "../units";

export type Excluded = { quote: Quote; reason: string };

export type Ranking = {
  /** Executable, fillable quotes that pass the venue rules, best `amountOut` first. */
  ranked: Quote[];
  /** Quotes that were seen but cannot be chosen, with the reason (shown in the UI). */
  excluded: Excluded[];
  /** Best on-chain AMM quote (V1/V2), if any; the V3 rule is measured against it. */
  bestAmm?: Quote;
};

export const isAmm = (v: VenueName): boolean => v === "SAUCER_V1" || v === "SAUCER_V2";

export const byOutDesc = (a: Quote, b: Quote): number =>
  b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0;

/** A stable identity for a route so re-quotes and splits can refer to it. */
export function routeKey(q: Quote): string {
  switch (q.venue) {
    case "SAUCER_V1":
      return `V1:${(q.path as string[]).join(">").toLowerCase()}`;
    case "SAUCER_V2":
      return `V2:${String(q.path).toLowerCase()}`;
    case "SAUCER_V3":
      return `V3:${q.bookId}:${q.side}`;
    case "LAMBDAPLEX":
      return `LP:${q.symbol}:${q.side}`;
  }
}

/**
 * Rank every quote on the same all-in basis (`amountOut` already has venue fees deducted).
 * Rules (mirror SaucerSwap's own router): a venue must be executable right now; the quote must be
 * fillable and clear the venue's minimum notional; V3 is only chosen when it beats the best AMM
 * output by at least `v3EdgeBps`. Lambdaplex competes on the same basis with its taker fee included.
 */
export function rankQuotes(reports: VenueReport[], opts: { v3EdgeBps?: number } = {}): Ranking {
  const edge = opts.v3EdgeBps ?? V3_EDGE_BPS;
  const excluded: Excluded[] = [];
  const candidates: Quote[] = [];
  for (const r of reports) {
    for (const q of r.quotes) {
      if (!r.status.ok) excluded.push({ quote: q, reason: r.status.reason ?? "venue not executable" });
      else if (!q.fillable) excluded.push({ quote: q, reason: "not fillable for this size" });
      else if (!q.minNotionalOk) excluded.push({ quote: q, reason: "below venue minimum notional" });
      else if (q.amountOut <= 0n) excluded.push({ quote: q, reason: "zero output" });
      else candidates.push(q);
    }
  }
  const bestAmm = candidates.filter(q => isAmm(q.venue)).sort(byOutDesc)[0];
  const ranked: Quote[] = [];
  for (const q of candidates) {
    if (q.venue === "SAUCER_V3" && bestAmm) {
      const floor = bestAmm.amountOut + applyBps(bestAmm.amountOut, edge);
      if (q.amountOut < floor) {
        excluded.push({ quote: q, reason: `V3 output not ≥ best AMM + ${edge} bps` });
        continue;
      }
    }
    ranked.push(q);
  }
  ranked.sort(byOutDesc);
  return { ranked, excluded, bestAmm };
}
