"use client";

import { useEffect, useMemo, useState } from "react";
import { PlanCard, VenueTable } from "./VenueTable";
import { type Net, useQuote, useTokens } from "./useQuote";
import type { QuoteResponse } from "~~/lib/router/server";

type Props = {
  /** Called whenever a fresh quote/plan arrives (the swap page executes it). */
  onQuote?: (
    q: QuoteResponse | null,
    params: { net: Net; in: string; out: string; amount: string; slippage: number },
  ) => void;
  defaultNet?: Net;
  showSlippage?: boolean;
};

const DEFAULT_PAIR: Record<Net, [string, string]> = { testnet: ["HBAR", "SAUCE"], mainnet: ["HBAR", "USDC"] };

export const QuotePanel = ({ onQuote, defaultNet = "testnet", showSlippage = false }: Props) => {
  const [net, setNet] = useState<Net>(defaultNet);
  const [tokenIn, setTokenIn] = useState(DEFAULT_PAIR[defaultNet][0]);
  const [tokenOut, setTokenOut] = useState(DEFAULT_PAIR[defaultNet][1]);
  const [amount, setAmount] = useState("10");
  const [slippage, setSlippage] = useState(50);
  const flags = useTokens(net);
  const params = useMemo(
    () => ({ net, in: tokenIn, out: tokenOut, amount, slippage }),
    [net, tokenIn, tokenOut, amount, slippage],
  );
  const { data, loading, error, reload } = useQuote(params);

  useEffect(() => {
    onQuote?.(data, params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const switchNet = (n: Net) => {
    setNet(n);
    setTokenIn(DEFAULT_PAIR[n][0]);
    setTokenOut(DEFAULT_PAIR[n][1]);
  };

  const symbols = flags?.tokens.map(t => t.symbol) ?? [tokenIn, tokenOut];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="form-control">
          <span className="label-text text-xs">Network</span>
          <div className="join">
            {(["testnet", "mainnet"] as Net[]).map(n => (
              <button
                key={n}
                className={`btn btn-sm join-item ${net === n ? "btn-primary" : "btn-ghost"}`}
                onClick={() => switchNet(n)}
              >
                {n === "mainnet" ? "mainnet (read-only)" : "testnet"}
              </button>
            ))}
          </div>
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Sell</span>
          <select
            className="select select-sm select-bordered"
            value={tokenIn}
            onChange={e => setTokenIn(e.target.value)}
          >
            {symbols.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-sm btn-ghost"
          title="flip"
          onClick={() => {
            setTokenIn(tokenOut);
            setTokenOut(tokenIn);
          }}
        >
          ⇄
        </button>
        <label className="form-control">
          <span className="label-text text-xs">Buy</span>
          <select
            className="select select-sm select-bordered"
            value={tokenOut}
            onChange={e => setTokenOut(e.target.value)}
          >
            {symbols.map(s => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="form-control">
          <span className="label-text text-xs">Amount</span>
          <input
            className="input input-sm input-bordered w-32"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
        </label>
        {showSlippage && (
          <label className="form-control">
            <span className="label-text text-xs">Slippage (bps)</span>
            <input
              className="input input-sm input-bordered w-24"
              type="number"
              value={slippage}
              onChange={e => setSlippage(Number(e.target.value))}
            />
          </label>
        )}
        <button className="btn btn-sm" onClick={reload} disabled={loading}>
          {loading ? <span className="loading loading-spinner loading-xs" /> : "Refresh"}
        </button>
      </div>
      {error && <div className="alert alert-error text-sm py-2">{error}</div>}
      {data && (
        <VenueTable
          reports={data.reports}
          plan={data.plan}
          excluded={data.excluded}
          tokenIn={data.tokenIn}
          tokenOut={data.tokenOut}
          demo={data.demo}
        />
      )}
      {data?.plan && <PlanCard plan={data.plan} tokenIn={data.tokenIn} tokenOut={data.tokenOut} />}
      {data?.error && <div className="alert alert-warning text-sm py-2">{data.error}</div>}
      {!data && !error && (
        <div className="text-sm text-base-content/60">
          {loading ? "Quoting SaucerSwap V1, V2, the V3 order book and Lambdaplex…" : "Pick a pair and an amount."}
        </div>
      )}
    </div>
  );
};
