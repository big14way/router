import type { ExecutionPlan, Quote, VenueReport } from "../types";
import { formatUnits } from "../units";

export function renderReport(r: VenueReport, decimals: number): string {
  const head = `${r.venue.padEnd(11)} ${r.status.ok ? "executable" : `unavailable: ${r.status.reason}`}  (${r.latencyMs} ms)`;
  if (!r.quotes.length) return head;
  return [head, ...r.quotes.map(q => `  ${renderQuote(q, decimals)}`)].join("\n");
}

export function renderQuote(q: Quote, decimals: number): string {
  const route =
    q.venue === "SAUCER_V1"
      ? `path ${(q.path as string[]).map(short).join(" → ")}`
      : q.venue === "SAUCER_V2"
        ? `fees ${q.fees?.join("/")}`
        : q.venue === "SAUCER_V3"
          ? `book ${q.bookId} ${q.side}`
          : `${q.symbol} ${q.side}`;
  const flags = `${q.fillable ? "fillable" : "NOT fillable"}${q.minNotionalOk ? "" : ", below minNotional"}`;
  const gas = q.gasEstimate ? `, gas ${q.gasEstimate}` : "";
  const fee = q.feeOut ? `, fee ${formatUnits(q.feeOut, decimals)}` : "";
  return `${route.padEnd(28)} out ${formatUnits(q.amountOut, decimals)}  [${flags}${gas}${fee}]`;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function renderPlan(plan: ExecutionPlan, decIn: number, decOut: number): string {
  const out = `${formatUnits(plan.totalOut, decOut)} ${plan.tokenOut.symbol} (min ${formatUnits(plan.totalMinOut, decOut)} @ ${plan.slippageBps} bps)`;
  const gain = plan.totalOut - plan.bestSingleVenue.amountOut;
  const vs = `best single ${plan.bestSingleVenue.venue} ${formatUnits(plan.bestSingleVenue.amountOut, decOut)}${gain > 0n ? `, split gains +${formatUnits(gain, decOut)}` : ""}`;
  const lines = [`plan ${plan.kind}: ${out}`, `  ${vs}`, `  planHash ${plan.planHash}`];
  if (plan.legs) {
    for (const l of plan.legs) {
      const pct = Number((l.amountIn * 10_000n) / plan.amountIn) / 100;
      lines.push(
        `  leg ${l.venue === 0 ? "V1" : "V2"} ${pct}%: ${formatUnits(l.amountIn, decIn)} → ${formatUnits(l.amountOut, decOut)} (min ${formatUnits(l.minOut, decOut)})`,
      );
    }
  } else if (plan.order) {
    lines.push(
      `  order ${plan.order.venue} ${plan.order.bookId ?? plan.order.symbol} ${plan.order.side}: ${formatUnits(plan.amountIn, decIn)} → ${formatUnits(plan.totalOut, decOut)}`,
    );
  }
  return lines.join("\n");
}
