"use client";

import type { ExecutionPlan, Quote, VenueReport } from "@sh/router-sdk/client";
import { KIND_LABEL, VENUE_LABEL, fmtUnits } from "~~/lib/router/format";
import type { SerialToken } from "~~/lib/router/server";

type Props = {
  reports: VenueReport[];
  plan?: ExecutionPlan;
  excluded: { venue: string; reason: string }[];
  tokenIn: SerialToken;
  tokenOut: SerialToken;
  demo: boolean;
};

const routeLabel = (q: Quote): string => {
  if (q.venue === "SAUCER_V1") return `${(q.path as string[]).length - 1}-hop pair`;
  if (q.venue === "SAUCER_V2") return `pool fee ${(q.fees ?? []).map(f => `${f / 10_000}%`).join(" → ")}`;
  if (q.venue === "SAUCER_V3") return `book ${q.bookId} · ${q.side}`;
  return `${q.symbol} · ${q.side}`;
};

const flagsFor = (q: Quote): string[] => {
  const f: string[] = [];
  const d = q.detail ?? {};
  if (q.venue === "SAUCER_V3") {
    f.push(String(d.status ?? "OPEN"));
    if (d.halted) f.push("halted");
    if (d.ammEnabled) f.push("AMM-backed");
    if (!q.minNotionalOk) f.push(`below minNotional`);
    if (d.onGrid === false) f.push("snapped to grid");
  }
  if (q.venue === "LAMBDAPLEX") {
    f.push(String(d.status ?? ""));
    if (d.levels !== undefined) f.push(`${d.levels} levels`);
    if (!q.minNotionalOk) f.push("below minNotional");
    if (d.feeSource) f.push(String(d.feeSource));
  }
  if (!q.fillable) f.push("not fillable");
  return f.filter(Boolean);
};

export const VenueTable = ({ reports, plan, excluded, tokenIn, tokenOut, demo }: Props) => {
  const winner = plan?.bestSingleVenue;
  const winnerKey = winner ? `${winner.venue}:${winner.amountOut}` : "";
  const rows = reports.flatMap(r =>
    r.quotes.length ? r.quotes.map((q, i) => ({ r, q, i })) : [{ r, q: undefined as Quote | undefined, i: 0 }],
  );
  return (
    <div className="overflow-x-auto">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Venue</th>
            <th>Route / book</th>
            <th className="text-right">Output ({tokenOut.symbol})</th>
            <th className="text-right">Fees / gas</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, q, i }) => {
            const isWinner = q && `${q.venue}:${q.amountOut}` === winnerKey;
            const reason = excluded.find(e => e.venue === r.venue)?.reason;
            return (
              <tr key={`${r.venue}-${i}`} className={isWinner ? "bg-primary/10 font-semibold" : ""}>
                <td>
                  {VENUE_LABEL[r.venue]}
                  {isWinner && <span className="badge badge-primary badge-sm ml-2">best single</span>}
                </td>
                <td className="text-xs">{q ? routeLabel(q) : "–"}</td>
                <td className="text-right font-mono">{q ? fmtUnits(q.amountOut, tokenOut.decimals) : "–"}</td>
                <td className="text-right text-xs font-mono">
                  {q?.feeOut ? `fee ${fmtUnits(q.feeOut, tokenOut.decimals)}` : ""}
                  {q?.gasEstimate ? ` gas ${q.gasEstimate.toString()}` : ""}
                  {!q?.feeOut && !q?.gasEstimate ? "–" : ""}
                </td>
                <td className="text-xs">
                  {r.status.ok ? (
                    <span className="badge badge-success badge-sm">executable</span>
                  ) : (
                    <span
                      className="badge badge-ghost badge-sm h-auto whitespace-normal text-left py-0.5"
                      title={r.status.reason}
                    >
                      {r.status.reason}
                    </span>
                  )}
                  {q &&
                    flagsFor(q).map(f => (
                      <span key={f} className="badge badge-outline badge-sm ml-1">
                        {f}
                      </span>
                    ))}
                  {r.status.ok && reason && (
                    <span className="badge badge-warning badge-sm ml-1 h-auto whitespace-normal text-left py-0.5">
                      {reason}
                    </span>
                  )}
                  <span className="text-base-content/40 ml-1">{r.latencyMs} ms</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {demo && (
        <p className="text-xs text-base-content/60 mt-2">
          Testnet pools are thin and priced arbitrarily: these are <strong>demo liquidity</strong> quotes for{" "}
          {tokenIn.symbol} → {tokenOut.symbol}.
        </p>
      )}
    </div>
  );
};

export const PlanCard = ({
  plan,
  tokenIn,
  tokenOut,
}: {
  plan: ExecutionPlan;
  tokenIn: SerialToken;
  tokenOut: SerialToken;
}) => {
  const gain = BigInt(plan.totalOut) - BigInt(plan.bestSingleVenue.amountOut);
  return (
    <div className="card bg-base-200 border border-base-300">
      <div className="card-body p-4 gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="card-title text-base m-0">Execution plan</h3>
          <span className="badge badge-primary">{KIND_LABEL[plan.kind]}</span>
          {gain > 0n && (
            <span className="badge badge-success">
              split beats best single by +{fmtUnits(gain, tokenOut.decimals)} {tokenOut.symbol}
            </span>
          )}
        </div>
        <p className="m-0 text-sm">
          {fmtUnits(plan.amountIn, tokenIn.decimals)} {tokenIn.symbol} →{" "}
          <strong>
            {fmtUnits(plan.totalOut, tokenOut.decimals)} {tokenOut.symbol}
          </strong>{" "}
          <span className="text-base-content/60">
            (min {fmtUnits(plan.totalMinOut, tokenOut.decimals)} at {plan.slippageBps} bps slippage)
          </span>
        </p>
        {plan.legs && (
          <ul className="m-0 pl-4 text-sm">
            {plan.legs.map((l, i) => {
              const pct = Number((BigInt(l.amountIn) * 10_000n) / BigInt(plan.amountIn)) / 100;
              return (
                <li key={i}>
                  {l.venue === 0 ? "SaucerSwap V1" : "SaucerSwap V2"} · {pct}% ·{" "}
                  {fmtUnits(l.amountIn, tokenIn.decimals)} {tokenIn.symbol} → {fmtUnits(l.amountOut, tokenOut.decimals)}{" "}
                  {tokenOut.symbol}{" "}
                  <span className="text-base-content/60">(min {fmtUnits(l.minOut, tokenOut.decimals)})</span>
                </li>
              );
            })}
          </ul>
        )}
        {plan.order && (
          <p className="m-0 text-sm">
            {VENUE_LABEL[plan.order.venue]} {plan.order.bookId ? `book ${plan.order.bookId}` : plan.order.symbol} ·{" "}
            {plan.order.side}
          </p>
        )}
        <p className="m-0 text-xs font-mono break-all text-base-content/60">planHash {plan.planHash}</p>
      </div>
    </div>
  );
};
