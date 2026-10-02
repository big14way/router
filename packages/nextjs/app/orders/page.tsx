"use client";

import { useEffect, useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";

type OrdersResponse = {
  configured: boolean;
  network: string;
  account: string | null;
  orders: unknown[];
  error?: string;
};

/** `/orders` — open SaucerSwap V3 (and Lambdaplex) orders for the connected or bot account, with cancel. */
const Orders: NextPage = () => {
  const { address } = useAccount();
  const [net, setNet] = useState<"testnet" | "mainnet">("testnet");
  const [data, setData] = useState<OrdersResponse | null>(null);
  useEffect(() => {
    fetch(`/api/v3/orders?net=${net}&account=${address ?? ""}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setData({ configured: false, network: net, account: null, orders: [], error: String(e) }));
  }, [net, address]);
  return (
    <div className="w-full max-w-5xl mx-auto px-5 py-8 flex flex-col gap-4">
      <h1 className="text-2xl font-bold m-0">Orders</h1>
      <div className="join">
        {(["testnet", "mainnet"] as const).map(n => (
          <button
            key={n}
            className={`btn btn-sm join-item ${net === n ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setNet(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 text-sm">
        {!data ? (
          <span className="loading loading-spinner" />
        ) : data.configured ? (
          data.orders.length ? (
            <pre className="text-xs">{JSON.stringify(data.orders, null, 2)}</pre>
          ) : (
            <p className="m-0">No open V3 orders for {data.account}.</p>
          )
        ) : (
          <div className="flex flex-col gap-2">
            <p className="m-0">
              Order tracking needs an authenticated V3 session.{" "}
              {address ? "Wallet-signed sessions" : "Connect a wallet, or"} configure <code>V3_BOT_ACCOUNT_ID</code> /{" "}
              <code>V3_BOT_PRIVATE_KEY</code> on the server for a bot account.
            </p>
            <p className="m-0 text-base-content/60">
              Lambdaplex orders appear here once <code>LAMBDAPLEX_API_KEY</code> is set.
            </p>
            {data.error && <p className="m-0 text-error">{data.error}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default Orders;
