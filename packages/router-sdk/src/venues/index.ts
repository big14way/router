import type { PublicClient } from "viem";
import type { NetworkConfig } from "../config";
import { publicClients } from "../evm";
import type { LambdaplexCredentials } from "../lambdaplex/auth";
import type { Quote, Token, VenueName, VenueReport } from "../types";
import { Lambdaplex } from "./Lambdaplex";
import { SaucerV1 } from "./SaucerV1";
import { SaucerV2 } from "./SaucerV2";
import { SaucerV3 } from "./SaucerV3";
import type { Venue } from "./Venue";

export { Lambdaplex, SaucerV1, SaucerV2, SaucerV3 };
export type { Venue, QuoteContext } from "./Venue";
export { encodeV2Path, type V2Hop } from "./SaucerV2";
export { bookStatus, type V3Book, type V3ExactInputQuote } from "./SaucerV3";
export {
  walkBook,
  assetOf,
  LAMBDAPLEX_DEFAULT_TAKER_BPS,
  type LambdaplexSymbol,
  type LambdaplexDepth,
} from "./Lambdaplex";

export type VenueOptions = {
  clients?: PublicClient[];
  fetchImpl?: typeof fetch;
  now?: () => number;
  v3AuthHeaders?: () => Promise<Record<string, string>>;
  lambdaplex?: { credentials?: LambdaplexCredentials; takerBpsEstimate?: number };
  /** Per-venue timeout for a quote round (ms). */
  venueTimeoutMs?: number;
};

export const VENUE_ORDER: VenueName[] = ["SAUCER_V1", "SAUCER_V2", "SAUCER_V3", "LAMBDAPLEX"];

/** Build the four adapters for a network. Lambdaplex is included on every network so the UI can explain why it is unavailable. */
export function createVenues(cfg: NetworkConfig, opts: VenueOptions = {}): Venue[] {
  const clients = opts.clients ?? publicClients(cfg);
  const ctx = { fetchImpl: opts.fetchImpl, now: opts.now };
  return [
    new SaucerV1(cfg, clients, ctx),
    new SaucerV2(cfg, clients, ctx),
    new SaucerV3(cfg, { ...ctx, authHeaders: opts.v3AuthHeaders }),
    new Lambdaplex(cfg, { ...ctx, ...opts.lambdaplex }),
  ];
}

/** Quote every venue concurrently; a failing venue becomes a report with a reason, never a throw. */
export async function quoteAll(
  venues: Venue[],
  tokenIn: Token,
  tokenOut: Token,
  amountIn: bigint,
  timeoutMs = 8_000,
): Promise<VenueReport[]> {
  return Promise.all(
    venues.map(async (venue): Promise<VenueReport> => {
      const started = Date.now();
      try {
        const status = await venue.canExecute(tokenIn, tokenOut);
        const quotes = await withTimeout(venue.quoteExactInput(tokenIn, tokenOut, amountIn), timeoutMs, venue.name);
        return { venue: venue.name, status, quotes, latencyMs: Date.now() - started };
      } catch (e) {
        return {
          venue: venue.name,
          status: { ok: false, reason: (e as Error).message },
          quotes: [],
          latencyMs: Date.now() - started,
        };
      }
    }),
  );
}

export const allQuotes = (reports: VenueReport[]): Quote[] => reports.flatMap(r => r.quotes);

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}
