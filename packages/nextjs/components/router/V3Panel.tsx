"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AppFlags } from "./useQuote";
import type { ExecutionPlan } from "@sh/router-sdk/client";
import type { Address, Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction, useSwitchChain } from "wagmi";
import { fmtUnits } from "~~/lib/router/format";
import { notification } from "~~/utils/scaffold-hbar";

type Step = { key: string; label: string; done: boolean; tx?: { to: Address; data: Hex; gas: string; value?: string } };
type Status = {
  configured: boolean;
  bot?: { accountId: string; evm: string } | null;
  signer?: "wallet" | "bot";
  account?: string;
  book?: { id: string; pair: string; status: string; halted: boolean };
  steps?: Step[];
  complete?: boolean;
  api?: { isComplete: boolean; pendingSteps: string[] };
  message?: string;
  error?: string;
};

const CHAIN_ID = { testnet: 296, mainnet: 295 } as const;

/**
 * V3_MARKET execution: onboarding checklist (one-click transactions for a connected wallet), then
 * placement through the server-side bot (0x00 signing). The wallet 0x01 path needs a Hedera
 * WalletConnect session, which the Scaffold-HBAR wallet stack does not provide (docs/DEVIATIONS D-9).
 */
export const V3Panel = ({ plan, flags }: { plan: ExecutionPlan; flags: AppFlags | null }) => {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{
    orderId?: string;
    txHashes?: string[];
    filledOut?: string;
    receipt?: { id?: string; error?: string };
    error?: string;
  } | null>(null);
  const bookId = plan.order?.bookId ?? "";
  const net = plan.network;

  const load = useCallback(async () => {
    const r = await fetch(`/api/v3/status?net=${net}&book=${bookId}&account=${address ?? ""}`)
      .then(x => x.json())
      .catch(e => ({ configured: false, message: String(e) }));
    setStatus(r);
  }, [net, bookId, address]);

  useEffect(() => {
    load();
  }, [load]);

  const runStep = async (s: Step) => {
    if (!s.tx) return;
    setBusy(s.key);
    try {
      if (chainId !== CHAIN_ID[net]) await switchChainAsync({ chainId: CHAIN_ID[net] });
      const gasPrice = await publicClient?.getGasPrice();
      const hash = await sendTransactionAsync({
        to: s.tx.to,
        data: s.tx.data,
        gas: BigInt(s.tx.gas),
        value: s.tx.value ? BigInt(s.tx.value) : undefined,
        gasPrice,
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      notification.success(`${s.label}: done`);
      await load();
    } catch (e) {
      notification.error((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const placeWithBot = async () => {
    setBusy("place");
    try {
      const r = await fetch("/api/v3/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      setResult({
        orderId: r.result?.refs?.orderId,
        txHashes: r.result?.txHashes,
        filledOut: r.result?.filledOut,
        receipt: r.receipt,
      });
      notification.success(`V3 order ${r.result?.refs?.orderId} filled`);
    } catch (e) {
      setResult({ error: (e as Error).message });
      notification.error((e as Error).message.slice(0, 300));
    } finally {
      setBusy(null);
    }
  };

  const halted = status?.book?.halted;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold m-0">SaucerSwap V3 market order</h3>
      <p className="text-sm m-0">
        Book {bookId} {status?.book ? `(${status.book.pair}, ${status.book.status}${halted ? ", halted" : ""})` : ""} ·{" "}
        {plan.order?.side} · {fmtUnits(plan.amountIn, plan.tokenIn.decimals)} {plan.tokenIn.symbol} →{" "}
        {fmtUnits(plan.totalOut, plan.tokenOut.decimals)} {plan.tokenOut.symbol}
      </p>
      {status?.steps && (
        <ul className="steps steps-vertical text-sm">
          {status.steps.map(s => (
            <li key={s.key} className={`step ${s.done ? "step-primary" : ""}`}>
              <span className="flex items-center gap-2">
                {s.label}
                {!s.done && s.tx && status.signer === "wallet" && (
                  <button className="btn btn-xs btn-outline" disabled={Boolean(busy)} onClick={() => runStep(s)}>
                    {busy === s.key ? <span className="loading loading-spinner loading-xs" /> : "do it"}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="alert text-sm py-2">{status?.message ?? "Checking onboarding…"}</div>
      {status?.signer === "wallet" && (
        <p className="text-xs text-base-content/60 m-0">
          Signing with this wallet uses the <code>0x01</code> Hedera personal-sign mode, which needs a Hedera
          WalletConnect session (not part of this template&apos;s wallet stack). Configure{" "}
          <code>V3_BOT_ACCOUNT_ID</code>/<code>V3_BOT_PRIVATE_KEY</code> to place through the server-side bot instead.
        </p>
      )}
      {flags?.v3Bot && (
        <button
          className="btn btn-primary"
          disabled={Boolean(busy) || Boolean(halted) || (status?.signer === "bot" && status?.complete === false)}
          onClick={placeWithBot}
        >
          {busy === "place" ? (
            <span className="loading loading-spinner" />
          ) : (
            `Place market order with bot ${status?.bot?.accountId ?? ""}`
          )}
        </button>
      )}
      {result?.error && <div className="alert alert-error text-sm py-2">{result.error}</div>}
      {result?.orderId && (
        <div className="alert alert-success text-sm flex-col items-start">
          <span>
            Order {result.orderId} filled
            {result.filledOut ? `: ${fmtUnits(result.filledOut, plan.tokenOut.decimals)} ${plan.tokenOut.symbol}` : ""}.
          </span>
          {result.txHashes?.map(h => (
            <a
              key={h}
              className="link"
              href={`https://hashscan.io/${net}/transaction/${h}`}
              target="_blank"
              rel="noreferrer"
            >
              {h}
            </a>
          ))}
          {result.receipt?.id && (
            <Link className="link" href={`/receipts/${result.receipt.id}`}>
              receipt {result.receipt.id}
            </Link>
          )}
        </div>
      )}
    </div>
  );
};
