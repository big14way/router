import {
  decodeFunctionResult,
  encodeFunctionData,
  encodePacked,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { V2_FEE_TIERS, type NetworkConfig } from "../config";
import { ethCall, ZERO_ADDRESS } from "../evm";
import { TtlCache, withRetry } from "../http";
import { ammToken, sameToken } from "../tokens";
import type { Quote, Token, VenueStatus } from "../types";
import { v2FactoryAbi, v2QuoterAbi } from "./abi";
import type { QuoteContext, Venue } from "./Venue";

const POOL_TTL_MS = 60_000;
/** Explicit simulation gas: QuoterV2 reverts internally to return data; relays need headroom. */
const QUOTE_GAS = 3_000_000n;

export type V2Hop = { tokenIn: Address; tokenOut: Address; fee: number };

/** Pack `[token][fee3][token]...` as the SwapRouter / QuoterV2 expect. */
export function encodeV2Path(hops: V2Hop[]): Hex {
  const types: ("address" | "uint24")[] = [];
  const values: (Address | number)[] = [];
  hops.forEach((h, i) => {
    if (i === 0) {
      types.push("address");
      values.push(h.tokenIn);
    }
    types.push("uint24", "address");
    values.push(h.fee, h.tokenOut);
  });
  return encodePacked(types, values);
}

/**
 * SaucerSwap V2 (UniswapV3-style concentrated liquidity). For every fee tier the factory is asked
 * whether a pool exists; direct and via-WHBAR paths are quoted with QuoterV2.quoteExactInput.
 */
export class SaucerV2 implements Venue {
  readonly name = "SAUCER_V2" as const;
  private readonly pools = new TtlCache<Address>(POOL_TTL_MS);

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly clients: PublicClient[],
    private readonly ctx: QuoteContext = {},
  ) {}

  async canExecute(tokenIn: Token, tokenOut: Token): Promise<VenueStatus> {
    const routes = await this.routes(tokenIn, tokenOut);
    return routes.length ? { ok: true } : { ok: false, reason: "no V2 pool on any fee tier (direct or via WHBAR)" };
  }

  async quoteExactInput(tokenIn: Token, tokenOut: Token, amountIn: bigint): Promise<Quote[]> {
    if (amountIn <= 0n || sameToken(tokenIn, tokenOut)) return [];
    const routes = await this.routes(tokenIn, tokenOut);
    const quotes = await Promise.all(routes.map(r => this.quoteRoute(r, amountIn)));
    return quotes
      .filter((q): q is Quote => q !== undefined && q.amountOut > 0n)
      .sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0));
  }

  /** Every hop combination with live pools: direct on each tier, and via WHBAR on each tier pair. */
  async routes(tokenIn: Token, tokenOut: Token): Promise<V2Hop[][]> {
    const a = ammToken(this.cfg, tokenIn).evm;
    const b = ammToken(this.cfg, tokenOut).evm;
    const whbar = this.cfg.tokens.WHBAR!.evm;
    const direct = await this.tiersWithPool(a, b);
    const routes: V2Hop[][] = direct.map(fee => [{ tokenIn: a, tokenOut: b, fee }]);
    if (a !== whbar && b !== whbar) {
      const [first, second] = await Promise.all([this.tiersWithPool(a, whbar), this.tiersWithPool(whbar, b)]);
      for (const f1 of first)
        for (const f2 of second)
          routes.push([
            { tokenIn: a, tokenOut: whbar, fee: f1 },
            { tokenIn: whbar, tokenOut: b, fee: f2 },
          ]);
    }
    return routes;
  }

  private async tiersWithPool(a: Address, b: Address): Promise<number[]> {
    const found = await Promise.all(
      V2_FEE_TIERS.map(
        async (fee): Promise<number | undefined> => ((await this.pool(a, b, fee)) !== ZERO_ADDRESS ? fee : undefined),
      ),
    );
    return found.filter((f): f is number => f !== undefined);
  }

  private async pool(a: Address, b: Address, fee: number): Promise<Address> {
    const key = `${[a, b]
      .map(x => x.toLowerCase())
      .sort()
      .join("/")}@${fee}`;
    const hit = this.pools.get(key);
    if (hit) return hit;
    const data = encodeFunctionData({ abi: v2FactoryAbi, functionName: "getPool", args: [a, b, fee] });
    const res = await withRetry(() =>
      ethCall(this.cfg, this.clients, this.cfg.saucer.v2Factory, data, { fetchImpl: this.ctx.fetchImpl }),
    ).catch(() => undefined);
    const pool = res ? decodeFunctionResult({ abi: v2FactoryAbi, functionName: "getPool", data: res }) : ZERO_ADDRESS;
    return this.pools.set(key, pool);
  }

  private async quoteRoute(hops: V2Hop[], amountIn: bigint): Promise<Quote | undefined> {
    const path = encodeV2Path(hops);
    const data = encodeFunctionData({ abi: v2QuoterAbi, functionName: "quoteExactInput", args: [path, amountIn] });
    const res = await withRetry(() =>
      ethCall(this.cfg, this.clients, this.cfg.saucer.v2Quoter, data, {
        fetchImpl: this.ctx.fetchImpl,
        gas: QUOTE_GAS,
      }),
    ).catch(() => undefined);
    if (!res) return undefined;
    const [amountOut, , ticks, gasEstimate] = decodeFunctionResult({
      abi: v2QuoterAbi,
      functionName: "quoteExactInput",
      data: res,
    });
    return {
      venue: this.name,
      path,
      fees: hops.map(h => h.fee),
      amountIn,
      amountOut,
      gasEstimate,
      fillable: amountOut > 0n,
      minNotionalOk: true,
      fetchedAt: (this.ctx.now ?? Date.now)(),
      detail: { hops: hops.length, ticksCrossed: ticks.reduce((s, t) => s + t, 0) },
    };
  }
}
