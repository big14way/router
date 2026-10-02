"use client";

import { useCallback, useEffect, useState } from "react";
import type { QuoteResponse, SerialToken } from "~~/lib/router/server";

export type Net = "testnet" | "mainnet";

export type AppFlags = {
  network: Net;
  tokens: SerialToken[];
  executor: string | null;
  receiptsTopic: string | null;
  mainnetExecution: boolean;
  v3Bot: boolean;
  lambdaplexKeyed: boolean;
};

export function useTokens(net: Net) {
  const [flags, setFlags] = useState<AppFlags | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/quote/tokens?net=${net}`)
      .then(r => r.json())
      .then(d => live && setFlags(d))
      .catch(() => live && setFlags(null));
    return () => {
      live = false;
    };
  }, [net]);
  return flags;
}

export type QuoteParams = { net: Net; in: string; out: string; amount: string; slippage?: number };

export function useQuote(params: QuoteParams | null, refreshMs = 15_000) {
  const [data, setData] = useState<QuoteResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = params ? `${params.net}|${params.in}|${params.out}|${params.amount}|${params.slippage ?? ""}` : "";

  const load = useCallback(async () => {
    if (!params || !params.amount || Number(params.amount) <= 0 || params.in === params.out) {
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ net: params.net, in: params.in, out: params.out, amount: params.amount });
      if (params.slippage !== undefined) q.set("slippage", String(params.slippage));
      const r = await fetch(`/api/quote?${q}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  return { data, loading, error, reload: load };
}
