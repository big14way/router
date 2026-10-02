import { decodeFunctionResult, encodeFunctionData, type Address, type PublicClient } from "viem";
import type { NetworkConfig } from "../config";
import { ethCall, ZERO_ADDRESS } from "../evm";
import { TtlCache, withRetry } from "../http";
import { ammToken, sameToken } from "../tokens";
import type { Quote, Token, VenueStatus } from "../types";
import { v1FactoryAbi, v1RouterAbi } from "./abi";
import type { QuoteContext, Venue } from "./Venue";

const PAIR_TTL_MS = 60_000;

/**
 * SaucerSwap V1 (UniswapV2-style). Candidate paths: direct `[in,out]` and `[in,WHBAR,out]`.
 * Missing pairs are skipped (factory.getPair == 0). Quotes via router.getAmountsOut through eth_call.
 */
export class SaucerV1 implements Venue {
  readonly name = "SAUCER_V1" as const;
  private readonly pairs = new TtlCache<Address>(PAIR_TTL_MS);

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly clients: PublicClient[],
    private readonly ctx: QuoteContext = {},
  ) {}

  async canExecute(tokenIn: Token, tokenOut: Token): Promise<VenueStatus> {
    const paths = await this.paths(tokenIn, tokenOut);
    return paths.length ? { ok: true } : { ok: false, reason: "no V1 pair (direct or via WHBAR)" };
  }

  async quoteExactInput(tokenIn: Token, tokenOut: Token, amountIn: bigint): Promise<Quote[]> {
    if (amountIn <= 0n || sameToken(tokenIn, tokenOut)) return [];
    const paths = await this.paths(tokenIn, tokenOut);
    const quotes = await Promise.all(paths.map(path => this.quotePath(path, amountIn)));
    return quotes
      .filter((q): q is Quote => q !== undefined && q.amountOut > 0n)
      .sort((a, b) => (b.amountOut > a.amountOut ? 1 : b.amountOut < a.amountOut ? -1 : 0));
  }

  /** Candidate address paths whose every hop has a live pair. */
  async paths(tokenIn: Token, tokenOut: Token): Promise<Address[][]> {
    const a = ammToken(this.cfg, tokenIn).evm;
    const b = ammToken(this.cfg, tokenOut).evm;
    const whbar = this.cfg.tokens.WHBAR!.evm;
    const candidates: Address[][] = [[a, b]];
    if (a !== whbar && b !== whbar) candidates.push([a, whbar, b]);
    const out: Address[][] = [];
    for (const path of candidates) {
      const hops = await Promise.all(path.slice(1).map((t, i) => this.pair(path[i]!, t)));
      if (hops.every(p => p !== ZERO_ADDRESS)) out.push(path);
    }
    return out;
  }

  private async pair(a: Address, b: Address): Promise<Address> {
    const key = [a, b]
      .map(x => x.toLowerCase())
      .sort()
      .join("/");
    const hit = this.pairs.get(key);
    if (hit) return hit;
    const data = encodeFunctionData({ abi: v1FactoryAbi, functionName: "getPair", args: [a, b] });
    const res = await withRetry(() =>
      ethCall(this.cfg, this.clients, this.cfg.saucer.v1Factory, data, { fetchImpl: this.ctx.fetchImpl }),
    ).catch(() => undefined);
    const pair = res ? decodeFunctionResult({ abi: v1FactoryAbi, functionName: "getPair", data: res }) : ZERO_ADDRESS;
    return this.pairs.set(key, pair);
  }

  private async quotePath(path: Address[], amountIn: bigint): Promise<Quote | undefined> {
    const data = encodeFunctionData({ abi: v1RouterAbi, functionName: "getAmountsOut", args: [amountIn, path] });
    const res = await withRetry(() =>
      ethCall(this.cfg, this.clients, this.cfg.saucer.v1Router, data, { fetchImpl: this.ctx.fetchImpl }),
    ).catch(() => undefined);
    if (!res) return undefined;
    const amounts = decodeFunctionResult({ abi: v1RouterAbi, functionName: "getAmountsOut", data: res });
    const amountOut = amounts[amounts.length - 1] ?? 0n;
    return {
      venue: this.name,
      path,
      amountIn,
      amountOut,
      fillable: amountOut > 0n,
      minNotionalOk: true,
      fetchedAt: (this.ctx.now ?? Date.now)(),
      detail: { hops: path.length - 1 },
    };
  }
}
