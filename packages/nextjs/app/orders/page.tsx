"use client";

import { useCallback, useEffect, useState } from "react";
import type { NextPage } from "next";
import { useAccount } from "wagmi";
import { notification } from "~~/utils/scaffold-hbar";

type Order = {
  info?: { nonce?: string };
  meta?: { id?: number | string; status?: string; [k: string]: unknown };
  input?: { token: string; amount: string };
  output?: { token: string; amount: string };
  [k: string]: unknown;
};
type OrdersResponse = {
  configured: boolean;
  network: string;
  account: string | null;
  evm?: string;
  orders: Order[];
  total: number;
  error?: string;
};
type Book = {
  id: string;
  baseTokenSymbol: string | null;
  quoteTokenSymbol: string | null;
  status: string;
  isMarketHalted: 0 | 1;
  tradable: { ok: boolean; reason?: string };
};

/** `/orders` — open SaucerSwap V3 orders for the bot account, with cancel; live book flags for context. */
const Orders: NextPage = () => {
  const { address } = useAccount();
  const [net, setNet] = useState<"testnet" | "mainnet">("testnet");
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, b] = await Promise.all([
      fetch(`/api/v3/orders?net=${net}`)
        .then(r => r.json())
        .catch(e => ({ configured: false, network: net, account: null, orders: [], total: 0, error: String(e) })),
      fetch(`/api/v3/books?net=${net}`)
        .then(r => r.json())
        .catch(() => ({ books: [] })),
    ]);
    setData(o);
    setBooks(b.books ?? []);
  }, [net]);

  useEffect(() => {
    load();
  }, [load]);

  const cancel = async (id: string | number) => {
    setBusy(String(id));
    try {
      const r = await fetch("/api/v3/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ net, orderIds: [id] }),
      }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      const c = r.confirmations?.[0];
      notification.success(
        c?.event ? `order ${id}: ${c.event.type ?? c.event.status ?? "terminal"}` : `cancel accepted for ${id}`,
      );
      await load();
    } catch (e) {
      notification.error((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-5 py-8 flex flex-col gap-4">
      <h1 className="text-2xl font-bold m-0">Orders</h1>
      <div className="flex gap-2 items-center">
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
        <button className="btn btn-sm" onClick={load}>
          Refresh
        </button>
      </div>
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 text-sm flex flex-col gap-3">
        {!data ? (
          <span className="loading loading-spinner" />
        ) : data.configured ? (
          <>
            <p className="m-0">
              Bot account <code>{data.account}</code> ({data.evm}) · {data.total} order(s)
            </p>
            {data.orders.length ? (
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>id</th>
                    <th>status</th>
                    <th>nonce</th>
                    <th>input</th>
                    <th>output</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map(o => (
                    <tr key={String(o.meta?.id)}>
                      <td>{String(o.meta?.id)}</td>
                      <td>{String(o.meta?.status ?? "")}</td>
                      <td>{o.info?.nonce}</td>
                      <td className="font-mono text-xs">
                        {o.input?.amount} {o.input?.token?.slice(0, 10)}…
                      </td>
                      <td className="font-mono text-xs">
                        {o.output?.amount} {o.output?.token?.slice(0, 10)}…
                      </td>
                      <td>
                        <button
                          className="btn btn-xs btn-outline"
                          disabled={Boolean(busy)}
                          onClick={() => cancel(o.meta!.id!)}
                        >
                          {busy === String(o.meta?.id) ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            "cancel"
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="m-0">No open V3 orders.</p>
            )}
            {data.error && <p className="m-0 text-error">{data.error}</p>}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="m-0">
              Order tracking needs an authenticated V3 session.{" "}
              {address
                ? "This wallet can run the onboarding steps on /swap; placing and listing orders from a wallet needs a Hedera WalletConnect session."
                : "Connect a wallet, or"}{" "}
              configure <code>V3_BOT_ACCOUNT_ID</code> / <code>V3_BOT_PRIVATE_KEY</code> on the server for a bot
              account.
            </p>
            <p className="m-0 text-base-content/60">
              Lambdaplex orders are out of scope for this build (quote-only venue).
            </p>
            {data.error && <p className="m-0 text-error">{data.error}</p>}
          </div>
        )}
      </div>
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 text-sm">
        <h2 className="font-semibold m-0 mb-2">V3 books on {net}</h2>
        {books.length ? (
          <ul className="m-0 pl-4">
            {books.map(b => (
              <li key={b.id}>
                book {b.id} {b.baseTokenSymbol}/{b.quoteTokenSymbol} · {b.status}
                {b.isMarketHalted ? " · halted" : ""} ·{" "}
                <span className={b.tradable.ok ? "text-success" : "text-base-content/60"}>
                  {b.tradable.ok ? "tradable" : b.tradable.reason}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-base-content/60">no books loaded</p>
        )}
      </div>
    </div>
  );
};

export default Orders;
