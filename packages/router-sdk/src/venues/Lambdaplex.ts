import type { NetworkConfig } from "../config";
import { signQuery, type LambdaplexCredentials } from "../lambdaplex/auth";
import { fetchJson, TtlCache } from "../http";
import { sameToken } from "../tokens";
import { parseUnits } from "../units";
import type { Quote, Token, VenueStatus } from "../types";
import type { QuoteContext, Venue } from "./Venue";

const INFO_TTL_MS = 60_000;
const PRICE_SCALE = 12;
const DEPTH_LIMIT = 100;

export type LambdaplexFilter =
  | { filterType: "PRICE_FILTER"; minPrice: string; maxPrice: string; tickSize: string }
  | { filterType: "LOT_SIZE"; minQty: string; maxQty: string; stepSize: string }
  | { filterType: "MIN_NOTIONAL"; minNotional: string; applyToMarket: boolean; avgPriceMins: number }
  | { filterType: string; [k: string]: unknown };

export type LambdaplexSymbol = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  baseAssetPrecision: number;
  quoteAssetPrecision: number;
  status: "TRADING" | "CANCEL_ONLY" | "PAUSED" | string;
  minNotionalStatus?: string;
  filters: LambdaplexFilter[];
};

export type LambdaplexDepth = { lastUpdateId: number; bids: [string, string][]; asks: [string, string][] };

export type LambdaplexFeeQuote = {
  vwap?: string | number;
  slippage?: string | number;
  regime?: string;
  feePreview?: {
    estimatedAppliedTakerBps?: number;
    estimatedTakerFee?: string | number;
    estimatedNetReceived?: string | number;
  };
};

export type LambdaplexOptions = QuoteContext & {
  credentials?: LambdaplexCredentials;
  /** Taker fee assumed when no API key is configured (fee-quote needs a key). */
  takerBpsEstimate?: number;
};

/** Reference connector default (hummingbot lambdaplex_utils.DEFAULT_FEES taker 0.25%). */
export const LAMBDAPLEX_DEFAULT_TAKER_BPS = 25;

/**
 * Lambdaplex central limit order book (mainnet only). Public `exchangeInfo` + `depth` give an
 * implied output by walking the book; with an API key `GET /api/v1/order/fee-quote` gives the
 * venue's own VWAP, slippage and fee. Trading requires the key, a funded account and
 * ALLOW_MAINNET_EXECUTION=true.
 */
export class Lambdaplex implements Venue {
  readonly name = "LAMBDAPLEX" as const;
  private readonly info = new TtlCache<LambdaplexSymbol[]>(INFO_TTL_MS);

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly opts: LambdaplexOptions = {},
  ) {}

  get keyed(): boolean {
    return Boolean(this.opts.credentials?.apiKey && this.opts.credentials.ed25519Seed);
  }

  async exchangeInfo(): Promise<LambdaplexSymbol[]> {
    const hit = this.info.get("info");
    if (hit) return hit;
    const res = await fetchJson<{ exchangeSymbols: LambdaplexSymbol[] }>(
      `${this.cfg.lambdaplexApiUrl}/api/v1/exchangeInfo`,
      {
        fetchImpl: this.opts.fetchImpl,
      },
    );
    return this.info.set("info", res.exchangeSymbols);
  }

  /** Match `BASE-QUOTE` either direction. Native HBAR is the `HBAR` asset. */
  async findSymbol(
    tokenIn: Token,
    tokenOut: Token,
  ): Promise<{ sym: LambdaplexSymbol; side: "BUY" | "SELL" } | undefined> {
    const list = await this.exchangeInfo();
    const a = assetOf(tokenIn);
    const b = assetOf(tokenOut);
    const sell = list.find(s => s.baseAsset === a && s.quoteAsset === b);
    if (sell) return { sym: sell, side: "SELL" };
    const buy = list.find(s => s.baseAsset === b && s.quoteAsset === a);
    if (buy) return { sym: buy, side: "BUY" };
    return undefined;
  }

  async canExecute(tokenIn: Token, tokenOut: Token): Promise<VenueStatus> {
    if (!this.cfg.lambdaplexApiUrl) return { ok: false, reason: "Lambdaplex is mainnet-only" };
    try {
      const m = await this.findSymbol(tokenIn, tokenOut);
      if (!m) return { ok: false, reason: "no Lambdaplex symbol for this pair" };
      if (m.sym.status !== "TRADING") return { ok: false, reason: `${m.sym.symbol} is ${m.sym.status}` };
      if (!this.keyed)
        return { ok: false, reason: "quote-only: LAMBDAPLEX_API_KEY / LAMBDAPLEX_ED25519_SEED not configured" };
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: `Lambdaplex API unavailable: ${(e as Error).message}` };
    }
  }

  async quoteExactInput(tokenIn: Token, tokenOut: Token, amountIn: bigint): Promise<Quote[]> {
    if (!this.cfg.lambdaplexApiUrl || amountIn <= 0n || sameToken(tokenIn, tokenOut)) return [];
    const m = await this.findSymbol(tokenIn, tokenOut);
    if (!m || m.sym.status !== "TRADING") return [];
    const { sym, side } = m;
    const depth = await fetchJson<LambdaplexDepth>(
      `${this.cfg.lambdaplexApiUrl}/api/v1/depth?symbol=${encodeURIComponent(sym.symbol)}&limit=${DEPTH_LIMIT}`,
      { fetchImpl: this.opts.fetchImpl },
    );
    const walk = walkBook(depth, side, amountIn, tokenIn.decimals, tokenOut.decimals);
    const minNotional = minNotionalOf(sym, tokenOut.decimals, tokenIn.decimals);
    const notional = side === "BUY" ? amountIn : walk.amountOut; // in quote units
    const takerBps = this.opts.takerBpsEstimate ?? LAMBDAPLEX_DEFAULT_TAKER_BPS;
    let feeOut = (walk.amountOut * BigInt(takerBps)) / 10_000n;
    let feeSource: string = `estimate ${takerBps} bps`;
    if (this.keyed && walk.fillable) {
      const fq = await this.feeQuote(sym, side, tokenIn, amountIn).catch(() => undefined);
      const net = fq?.feePreview?.estimatedNetReceived;
      if (net !== undefined) {
        const netUnits = parseUnits(String(net), tokenOut.decimals);
        feeOut = walk.amountOut > netUnits ? walk.amountOut - netUnits : 0n;
        feeSource = `fee-quote ${fq?.feePreview?.estimatedAppliedTakerBps ?? "?"} bps`;
      }
    }
    return [
      {
        venue: this.name,
        symbol: sym.symbol,
        side,
        amountIn,
        amountOut: walk.amountOut - feeOut,
        feeOut,
        fillable: walk.fillable,
        minNotionalOk: notional >= minNotional,
        fetchedAt: (this.opts.now ?? Date.now)(),
        detail: {
          status: sym.status,
          levels: walk.levels,
          depthConsumed: walk.consumed.toString(),
          minNotional: minNotional.toString(),
          feeSource,
          keyed: this.keyed,
        },
      },
    ];
  }

  private async feeQuote(
    sym: LambdaplexSymbol,
    side: "BUY" | "SELL",
    tokenIn: Token,
    amountIn: bigint,
  ): Promise<LambdaplexFeeQuote> {
    const creds = this.opts.credentials!;
    const sizing: Record<string, string> =
      side === "SELL"
        ? { quantity: formatFixed(amountIn, tokenIn.decimals) }
        : { quoteOrderQty: formatFixed(amountIn, tokenIn.decimals) };
    const { query, headers } = signQuery({ symbol: sym.symbol, side, type: "MARKET", ...sizing }, creds);
    return fetchJson<LambdaplexFeeQuote>(`${this.cfg.lambdaplexApiUrl}/api/v1/order/fee-quote?${query}`, {
      headers,
      fetchImpl: this.opts.fetchImpl,
    });
  }
}

export const assetOf = (t: Token): string => (t.native ? "HBAR" : t.symbol.toUpperCase());

function formatFixed(amount: bigint, decimals: number): string {
  const s = amount.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return decimals === 0 ? s : `${s.slice(0, -decimals)}${frac ? `.${frac}` : ""}`;
}

function minNotionalOf(sym: LambdaplexSymbol, quoteDecIfSell: number, quoteDecIfBuy: number): bigint {
  const f = sym.filters.find(x => x.filterType === "MIN_NOTIONAL") as { minNotional?: string } | undefined;
  const dec = quoteDecIfSell === quoteDecIfBuy ? quoteDecIfSell : sym.quoteAssetPrecision;
  return f?.minNotional ? parseUnits(f.minNotional, dec) : 0n;
}

/**
 * Walk the book. SELL base: consume bids (best first) with `amountIn` base units, output quote units.
 * BUY base: spend `amountIn` quote units against asks, output base units.
 */
export function walkBook(
  depth: LambdaplexDepth,
  side: "BUY" | "SELL",
  amountIn: bigint,
  decIn: number,
  decOut: number,
): { amountOut: bigint; consumed: bigint; fillable: boolean; levels: number } {
  const scale = 10n ** BigInt(PRICE_SCALE);
  let remaining = amountIn;
  let out = 0n;
  let levels = 0;
  const book = side === "SELL" ? depth.bids : depth.asks;
  for (const [priceStr, qtyStr] of book) {
    if (remaining <= 0n) break;
    const price = parseUnits(priceStr, PRICE_SCALE);
    levels += 1;
    if (side === "SELL") {
      const qty = parseUnits(qtyStr, decIn); // base available at this bid
      const take = qty < remaining ? qty : remaining;
      out += (take * price * 10n ** BigInt(decOut)) / (scale * 10n ** BigInt(decIn));
      remaining -= take;
    } else {
      const qty = parseUnits(qtyStr, decOut); // base offered at this ask
      const cost = (qty * price * 10n ** BigInt(decIn)) / (scale * 10n ** BigInt(decOut)); // quote needed for the whole level
      if (cost <= remaining) {
        out += qty;
        remaining -= cost;
      } else {
        out += (remaining * scale * 10n ** BigInt(decOut)) / (price * 10n ** BigInt(decIn));
        remaining = 0n;
      }
    }
  }
  return { amountOut: out, consumed: amountIn - remaining, fillable: remaining === 0n && amountIn > 0n, levels };
}
