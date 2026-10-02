import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import type { NetworkConfig } from "./config";
import { fetchJson } from "./http";

/** Read-only clients for the primary relay followed by each fallback relay. */
export function publicClients(cfg: NetworkConfig, timeoutMs = 5_000): PublicClient[] {
  return [cfg.rpcUrl, ...cfg.fallbackRpcUrls].map(url =>
    createPublicClient({ transport: http(url, { timeout: timeoutMs, retryCount: 0 }) }),
  );
}

export type EthCallOptions = { fetchImpl?: typeof fetch; gas?: bigint };

/**
 * Read-only EVM call with failover: primary relay → fallback relays → mirror node
 * `/api/v1/contracts/call`. Public relays are rate limited and the mirror-node-backed ones reject
 * some heavy simulations; callers wrap this in `withRetry` for transient errors.
 */
export async function ethCall(
  cfg: NetworkConfig,
  clients: PublicClient[],
  to: Hex,
  data: Hex,
  opts: EthCallOptions = {},
): Promise<Hex> {
  const errors: string[] = [];
  for (const client of clients) {
    try {
      const r = await client.call({ to, data, gas: opts.gas });
      if (r.data) return r.data;
      errors.push("empty result");
    } catch (e) {
      errors.push(summarize(e));
    }
  }
  try {
    const res = await fetchJson<{ result?: Hex }>(`${cfg.mirrorUrl}/api/v1/contracts/call`, {
      method: "POST",
      body: { block: "latest", to, data, ...(opts.gas ? { gas: Number(opts.gas) } : {}) },
      retries: 0,
      fetchImpl: opts.fetchImpl,
    });
    if (res.result) return res.result;
    errors.push("mirror: no result");
  } catch (e) {
    errors.push(`mirror: ${summarize(e)}`);
  }
  throw new Error(`eth_call failed on every endpoint: ${errors.join(" | ")}`);
}

function summarize(e: unknown): string {
  const err = e as { shortMessage?: string; details?: string; message?: string };
  return (err.details ?? err.shortMessage ?? err.message ?? String(e)).replace(/\s+/g, " ").slice(0, 160);
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
