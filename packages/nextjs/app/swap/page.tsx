"use client";

import { useState } from "react";
import type { NextPage } from "next";
import { ExecutePanel } from "~~/components/router/ExecutePanel";
import { QuotePanel } from "~~/components/router/QuotePanel";
import { type Net, useTokens } from "~~/components/router/useQuote";
import type { QuoteResponse } from "~~/lib/router/server";

/** `/swap` — connect a wallet, see the plan, execute it on whichever venue won. */
const Swap: NextPage = () => {
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [net, setNet] = useState<Net>("testnet");
  const flags = useTokens(net);
  return (
    <div className="w-full max-w-5xl mx-auto px-5 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold m-0">Swap</h1>
        <p className="text-sm text-base-content/70 m-0">
          The plan below is re-quoted every 15 s. On-chain splits run atomically through RouterExecutor; V3 and
          Lambdaplex plans run through their signed-order APIs. Every execution publishes an HCS receipt.
        </p>
      </div>
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300">
        <QuotePanel
          showSlippage
          onQuote={(q, p) => {
            setQuote(q);
            setNet(p.net);
          }}
        />
      </div>
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300">
        {quote ? (
          <ExecutePanel quote={quote} flags={flags} />
        ) : (
          <p className="text-sm text-base-content/60 m-0">Waiting for a quote…</p>
        )}
      </div>
    </div>
  );
};

export default Swap;
