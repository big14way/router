"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { V3Panel } from "./V3Panel";
import type { AppFlags } from "./useQuote";
import { type ExecutionPlan, encodeLegPath, tinybarToWeibar } from "@sh/router-sdk/client";
import { type Address, type Hex, decodeEventLog } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { erc20Abi, hip719Abi, routerExecutorAbi } from "~~/lib/router/executorAbi";
import { KIND_LABEL, fmtUnits } from "~~/lib/router/format";
import type { QuoteResponse } from "~~/lib/router/server";
import { notification } from "~~/utils/scaffold-hbar";

type Props = { quote: QuoteResponse; flags: AppFlags | null };

const CHAIN_ID = { testnet: 296, mainnet: 295 } as const;
const MIRROR = {
  testnet: "https://testnet.mirrornode.hedera.com",
  mainnet: "https://mainnet.mirrornode.hedera.com",
} as const;
const HASHSCAN = { testnet: "https://hashscan.io/testnet", mainnet: "https://hashscan.io/mainnet" } as const;

type Step = {
  key: string;
  label: string;
  done: boolean;
  action?: () => Promise<void>;
  busy?: boolean;
  detail?: string;
};

/** Executes whatever kind of plan the router produced. */
export const ExecutePanel = ({ quote, flags }: Props) => {
  const plan = quote.plan;
  if (!plan)
    return <div className="alert text-sm">No executable route right now{quote.error ? `: ${quote.error}` : "."}</div>;
  if (plan.network === "mainnet" && !flags?.mainnetExecution) {
    return (
      <div className="alert alert-warning text-sm">
        Mainnet execution is disabled. Set <code>ALLOW_MAINNET_EXECUTION=true</code> (and{" "}
        <code>MAINNET_MAX_NOTIONAL_USD</code>) on the server to enable it.
      </div>
    );
  }
  if (plan.kind === "ONCHAIN_SPLIT") return <OnchainExecute quote={quote} plan={plan} flags={flags} />;
  if (plan.kind === "V3_MARKET") return <V3Panel plan={plan} flags={flags} />;
  return <LambdaplexExecute plan={plan} flags={flags} />;
};

const OnchainExecute = ({
  quote,
  plan,
  flags,
}: {
  quote: QuoteResponse;
  plan: ExecutionPlan;
  flags: AppFlags | null;
}) => {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [associated, setAssociated] = useState<boolean | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ tx: Hex; totalOut: bigint; receipt?: string } | null>(null);

  const net = plan.network;
  const executor = flags?.executor as Address | null | undefined;
  const whbar = quote.reports.length ? undefined : undefined; // placeholder to keep types simple
  const tokenIn = plan.tokenIn;
  const tokenOut = plan.tokenOut;
  const hbarIn = Boolean(tokenIn.native);
  const unwrap = Boolean(tokenOut.native);
  const amountIn = BigInt(plan.amountIn);
  void whbar;

  useEffect(() => {
    if (!address) return;
    let live = true;
    const run = async () => {
      if (!tokenOut.native) {
        const r = await fetch(`${MIRROR[net]}/api/v1/accounts/${address}/tokens?token.id=${tokenOut.id}`)
          .then(x => x.json())
          .catch(() => null);
        if (live) setAssociated(Boolean(r?.tokens?.length));
      } else if (live) setAssociated(true);
      if (!hbarIn && publicClient && executor) {
        const a = await publicClient
          .readContract({
            address: tokenIn.evm as Address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [address, executor],
          })
          .catch(() => 0n);
        if (live) setAllowance(a as bigint);
      } else if (live) setAllowance(amountIn);
    };
    run();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, plan.planHash, busy]);

  const ensureChain = async () => {
    if (chainId !== CHAIN_ID[net]) await switchChainAsync({ chainId: CHAIN_ID[net] });
  };

  const associate = async () => {
    setBusy("associate");
    try {
      await ensureChain();
      const tx = await writeContractAsync({
        address: tokenOut.evm as Address,
        abi: hip719Abi,
        functionName: "associate",
        gas: 1_000_000n,
      });
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      notification.success(`Associated ${tokenOut.symbol}`);
    } catch (e) {
      notification.error((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    setBusy("approve");
    try {
      await ensureChain();
      const tx = await writeContractAsync({
        address: tokenIn.evm as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [executor!, amountIn],
        gas: 1_000_000n,
      });
      await publicClient?.waitForTransactionReceipt({ hash: tx });
      notification.success(`Approved RouterExecutor for ${fmtUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`);
    } catch (e) {
      notification.error((e as Error).message.slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const execute = async () => {
    if (!executor || !address || !plan.legs) return;
    setBusy("execute");
    try {
      await ensureChain();
      const legs = plan.legs.map(l => ({
        venue: l.venue,
        path: encodeLegPath(l),
        amountIn: BigInt(l.amountIn),
        minOut: BigInt(l.minOut),
      }));
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const tokenInAddr = (hbarIn ? whbarAddress(quote) : tokenIn.evm) as Address;
      const tokenOutAddr = (unwrap ? whbarAddress(quote) : tokenOut.evm) as Address;
      const tx = await writeContractAsync({
        address: executor,
        abi: routerExecutorAbi,
        functionName: "executeSplit",
        args: [tokenInAddr, tokenOutAddr, legs, BigInt(plan.totalMinOut), deadline, address, unwrap],
        value: hbarIn ? tinybarToWeibar(amountIn) : 0n,
        gas: BigInt(Math.min(15_000_000, 2_500_000 + 3_000_000 * legs.length)),
      });
      const rc = await publicClient!.waitForTransactionReceipt({ hash: tx });
      let totalOut = 0n;
      let planHash: Hex | undefined;
      for (const log of rc.logs) {
        try {
          const ev = decodeEventLog({ abi: routerExecutorAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "RouteExecuted") {
            totalOut = ev.args.totalOut;
            planHash = ev.args.planHash;
          }
        } catch {
          /* not our event */
        }
      }
      if (rc.status !== "success") throw new Error("transaction reverted");
      notification.success(`Received ${fmtUnits(totalOut, tokenOut.decimals)} ${tokenOut.symbol}`);
      const receipt = await fetch("/api/receipt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plan,
          txHashes: [tx],
          filledIn: amountIn.toString(),
          filledOut: totalOut.toString(),
          onchainPlanHash: planHash,
        }),
      })
        .then(r => r.json())
        .catch(e => ({ error: String(e) }));
      setResult({
        tx,
        totalOut,
        receipt: receipt?.id ?? (receipt?.error ? `receipt not published: ${receipt.error}` : undefined),
      });
    } catch (e) {
      notification.error((e as Error).message.slice(0, 300));
    } finally {
      setBusy(null);
    }
  };

  const steps: Step[] = [
    { key: "wallet", label: "Connect a wallet on " + net, done: Boolean(address) && chainId === CHAIN_ID[net] },
    {
      key: "executor",
      label: "RouterExecutor deployed (NEXT_PUBLIC_ROUTER_EXECUTOR)",
      done: Boolean(executor),
      detail: executor ?? "not configured",
    },
    {
      key: "associate",
      label: `Associate ${tokenOut.symbol} to your account (HIP-719)`,
      done: associated === true,
      action: associate,
      busy: busy === "associate",
    },
    ...(hbarIn
      ? []
      : [
          {
            key: "approve",
            label: `Approve RouterExecutor to spend ${fmtUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol}`,
            done: allowance !== null && allowance >= amountIn,
            action: approve,
            busy: busy === "approve",
          },
        ]),
  ];
  const ready = steps.every(s => s.done);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-semibold m-0">{KIND_LABEL[plan.kind]}</h3>
      <ul className="steps steps-vertical text-sm">
        {steps.map(s => (
          <li key={s.key} className={`step ${s.done ? "step-primary" : ""}`}>
            <span className="flex items-center gap-2">
              {s.label}
              {s.detail && <code className="text-xs">{s.detail}</code>}
              {!s.done && s.action && address && (
                <button className="btn btn-xs btn-outline" onClick={s.action} disabled={Boolean(busy)}>
                  {s.busy ? <span className="loading loading-spinner loading-xs" /> : "do it"}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button className="btn btn-primary" onClick={execute} disabled={!ready || Boolean(busy)}>
        {busy === "execute" ? (
          <span className="loading loading-spinner" />
        ) : (
          `Execute: ${fmtUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol} → ≥ ${fmtUnits(plan.totalMinOut, tokenOut.decimals)} ${tokenOut.symbol}`
        )}
      </button>
      {result && (
        <div className="alert alert-success text-sm flex-col items-start">
          <span>
            Filled {fmtUnits(result.totalOut, tokenOut.decimals)} {tokenOut.symbol}.{" "}
            <a className="link" href={`${HASHSCAN[net]}/transaction/${result.tx}`} target="_blank" rel="noreferrer">
              HashScan
            </a>
          </span>
          {result.receipt && (
            <span>
              Receipt:{" "}
              {result.receipt.startsWith("receipt not") ? (
                result.receipt
              ) : (
                <Link className="link" href={`/receipts/${result.receipt}`}>
                  {result.receipt}
                </Link>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/** WHBAR address for the quote's network (the native-HBAR leg uses it on chain). */
const whbarAddress = (quote: QuoteResponse): string => {
  const v1 = quote.reports.find(r => r.venue === "SAUCER_V1")?.quotes[0];
  if (v1 && Array.isArray(v1.path)) return quote.tokenIn.native ? v1.path[0]! : v1.path[v1.path.length - 1]!;
  const v2 = quote.reports.find(r => r.venue === "SAUCER_V2")?.quotes[0];
  if (v2 && typeof v2.path === "string") return quote.tokenIn.native ? v2.path.slice(0, 42) : `0x${v2.path.slice(-40)}`;
  throw new Error("no AMM route to derive the WHBAR address from");
};

const LambdaplexExecute = ({ plan, flags }: { plan: ExecutionPlan; flags: AppFlags | null }) => (
  <div className="flex flex-col gap-3">
    <h3 className="font-semibold m-0">{KIND_LABEL[plan.kind]}</h3>
    <p className="text-sm m-0">
      {plan.order?.symbol} · {plan.order?.side} · {fmtUnits(plan.amountIn, plan.tokenIn.decimals)} {plan.tokenIn.symbol}{" "}
      → {fmtUnits(plan.totalOut, plan.tokenOut.decimals)} {plan.tokenOut.symbol}
    </p>
    <div className="alert alert-info text-sm">
      {flags?.lambdaplexKeyed
        ? "Lambdaplex is keyed on the server, but order placement is not enabled in this build; the adapter quotes only."
        : "Lambdaplex execution is keyed: set LAMBDAPLEX_API_KEY and LAMBDAPLEX_ED25519_SEED on the server. This build quotes Lambdaplex only."}
    </div>
  </div>
);
