import {
  type ExecutionPlan,
  type Network,
  type NetworkConfig,
  type Requote,
  type VenueReport,
  buildPlan,
  configFromEnv,
  createVenues,
  parseNetwork,
  quoteAll,
  resolveToken,
  routeKey,
} from "@sh/router-sdk";
import type { Venue } from "@sh/router-sdk";
import "server-only";

/**
 * Server-side router entry used by the API routes. Secrets (bot keys, Lambdaplex key) never leave
 * this module; the browser only sees serialised quotes and plans.
 */
export type QuoteResponse = {
  network: Network;
  demo: boolean;
  tokenIn: SerialToken;
  tokenOut: SerialToken;
  amountIn: string;
  reports: VenueReport[];
  plan?: ExecutionPlan;
  excluded: { venue: string; reason: string }[];
  error?: string;
  fetchedAt: number;
};

export type SerialToken = { id: string; evm: string; symbol: string; name: string; decimals: number; native?: boolean };

/** Network config with env overrides (relays, extra tokens from `yarn seed:testnet`). */
export function serverConfig(network: Network): NetworkConfig {
  return configFromEnv(network);
}

export function serverVenues(cfg: NetworkConfig): Venue[] {
  const apiKey = process.env.LAMBDAPLEX_API_KEY;
  const seed = process.env.LAMBDAPLEX_ED25519_SEED;
  return createVenues(cfg, {
    lambdaplex: apiKey && seed ? { credentials: { apiKey, ed25519Seed: seed } } : undefined,
  });
}

export const ALLOW_MAINNET = process.env.ALLOW_MAINNET_EXECUTION === "true";
export const MAINNET_MAX_NOTIONAL_USD = Number(process.env.MAINNET_MAX_NOTIONAL_USD ?? "20");

export async function quoteAndPlan(params: {
  net?: string;
  in?: string;
  out?: string;
  amount?: string;
  slippageBps?: number;
  split?: boolean;
}): Promise<QuoteResponse> {
  const network = parseNetwork(params.net);
  const cfg = serverConfig(network);
  const tokenIn = resolveToken(cfg, params.in ?? "HBAR");
  const tokenOut = resolveToken(cfg, params.out ?? "USDC");
  const amountIn = parseAmount(params.amount ?? "10", tokenIn.decimals);
  const venues = serverVenues(cfg);
  const reports = await quoteAll(venues, tokenIn, tokenOut, amountIn);
  const requote: Requote | undefined =
    params.split === false
      ? undefined
      : async (route, amt) => {
          const venue = venues.find(v => v.name === route.venue);
          const quotes = venue ? await venue.quoteExactInput(tokenIn, tokenOut, amt) : [];
          return quotes.find(q => routeKey(q) === routeKey(route))?.amountOut;
        };
  const base = {
    network,
    demo: network === "testnet",
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    reports,
    fetchedAt: Date.now(),
  };
  try {
    const { plan, ranking } = await buildPlan({
      cfg,
      tokenIn,
      tokenOut,
      amountIn,
      reports,
      requote,
      slippageBps: params.slippageBps,
    });
    return { ...base, plan, excluded: ranking.excluded.map(e => ({ venue: e.quote.venue, reason: e.reason })) };
  } catch (e) {
    return { ...base, excluded: [], error: (e as Error).message };
  }
}

function parseAmount(amount: string, decimals: number): bigint {
  const s = amount.trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error(`invalid amount: ${amount}`);
  const [whole = "0", frac = ""] = s.split(".");
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.slice(0, decimals).padEnd(decimals, "0") || "0");
}

/** JSON.stringify replacer: bigint → string. */
export const jsonSafe = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);
