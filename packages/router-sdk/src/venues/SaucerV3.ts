import type { NetworkConfig } from "../config";
import { fetchJson, HttpError, TtlCache } from "../http";
import { sameToken } from "../tokens";
import type { Quote, Token, VenueStatus } from "../types";
import type { QuoteContext, Venue } from "./Venue";

const BOOKS_TTL_MS = 60_000;
/** Fees on the Orderbook API are in pips: 1 pip = 1e-6 (100 pips = 1 bp). */
const PIPS = 1_000_000n;

export type V3Book = {
  id: string;
  baseTokenId: string;
  quoteTokenId: string;
  baseTokenEvmAddress: string;
  quoteTokenEvmAddress: string;
  status: "OPEN" | "CLOSED" | string;
  isAMMEnabled: 0 | 1;
  isMarketHalted: 0 | 1;
  baseTokenSymbol: string | null;
  quoteTokenSymbol: string | null;
  baseTokenDecimals: number | null;
  quoteTokenDecimals: number | null;
  tickStep: string;
  sizeStep: string;
  lotSize: string;
  minNotional: string;
  takerFeePips?: number;
  makerFeePips?: number;
};

export type V3ExactInputQuote = {
  outputToken: string;
  snappedInputAmount: string;
  consumedInputAmount: string;
  expectedOutputAmount: string;
  suggestedOutputAmount: string;
  slippageBps: number;
  fillable: boolean;
};

export type V3Options = QuoteContext & {
  /** Returns `Authorization` headers when a bot account is configured (Phase 7 auth). */
  authHeaders?: () => Promise<Record<string, string>>;
};

/**
 * SaucerSwap V3 order book. Reads `GET /books` (cached 60 s), requires the book to be OPEN and not
 * halted, then asks `GET /books/:id/quote/exact-input`. A 401 on a public endpoint (rollout is per
 * network) falls back to JWT when a bot is configured, otherwise the venue is "unavailable", not an error.
 */
export class SaucerV3 implements Venue {
  readonly name = "SAUCER_V3" as const;
  private readonly books = new TtlCache<V3Book[]>(BOOKS_TTL_MS);

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly opts: V3Options = {},
  ) {}

  async listBooks(): Promise<V3Book[]> {
    const hit = this.books.get("books");
    if (hit) return hit;
    const res = await this.get<{ orderbooks: V3Book[] }>("/books");
    return this.books.set("books", res.orderbooks);
  }

  /** The book trading exactly this pair (either direction), with the side the input maps to. */
  async findBook(tokenIn: Token, tokenOut: Token): Promise<{ book: V3Book; side: "BUY" | "SELL" } | undefined> {
    const books = await this.listBooks();
    const is = (t: Token, id: string, evm: string) => t.id === id || t.evm.toLowerCase() === evm.toLowerCase();
    const matches: { book: V3Book; side: "BUY" | "SELL" }[] = [];
    for (const book of books) {
      const sell =
        is(tokenIn, book.baseTokenId, book.baseTokenEvmAddress) &&
        is(tokenOut, book.quoteTokenId, book.quoteTokenEvmAddress);
      const buy =
        is(tokenIn, book.quoteTokenId, book.quoteTokenEvmAddress) &&
        is(tokenOut, book.baseTokenId, book.baseTokenEvmAddress);
      if (sell) matches.push({ book, side: "SELL" });
      else if (buy) matches.push({ book, side: "BUY" });
    }
    // A pair can have several books (testnet lists three HBAR/USDC ids); prefer a tradable one.
    return matches.find(m => bookStatus(m.book).ok) ?? matches[0];
  }

  async canExecute(tokenIn: Token, tokenOut: Token): Promise<VenueStatus> {
    try {
      const match = await this.findBook(tokenIn, tokenOut);
      if (!match) return { ok: false, reason: "no V3 book for this pair" };
      return bookStatus(match.book);
    } catch (e) {
      return { ok: false, reason: `V3 API unavailable: ${(e as Error).message}` };
    }
  }

  async quoteExactInput(tokenIn: Token, tokenOut: Token, amountIn: bigint): Promise<Quote[]> {
    if (amountIn <= 0n || sameToken(tokenIn, tokenOut)) return [];
    const match = await this.findBook(tokenIn, tokenOut);
    if (!match || !bookStatus(match.book).ok) return [];
    const { book, side } = match;
    const inputToken = side === "SELL" ? book.baseTokenEvmAddress : book.quoteTokenEvmAddress;
    const q = await this.get<V3ExactInputQuote>(
      `/books/${book.id}/quote/exact-input?inputToken=${inputToken}&inputAmount=${amountIn}`,
    );
    const snapped = BigInt(q.snappedInputAmount);
    const consumed = BigInt(q.consumedInputAmount);
    const expected = BigInt(q.expectedOutputAmount);
    const takerFeePips = BigInt(book.takerFeePips ?? 0);
    const feeOut = (expected * takerFeePips) / PIPS;
    const minNotional = BigInt(book.minNotional || "0");
    const notional = side === "BUY" ? snapped : expected; // notional is measured in the quote token
    const fillable = q.fillable && snapped > 0n && consumed === snapped;
    return [
      {
        venue: this.name,
        bookId: book.id,
        side,
        amountIn: snapped,
        amountOut: expected - feeOut,
        feeOut,
        fillable,
        minNotionalOk: notional >= minNotional,
        fetchedAt: (this.opts.now ?? Date.now)(),
        snappedInputAmount: snapped,
        detail: {
          status: book.status,
          halted: book.isMarketHalted === 1,
          ammEnabled: book.isAMMEnabled === 1,
          minNotional: book.minNotional,
          takerFeePips: book.takerFeePips ?? 0,
          slippageBps: q.slippageBps,
          suggestedOutputAmount: q.suggestedOutputAmount,
          expectedOutputAmount: q.expectedOutputAmount,
          onGrid: snapped === amountIn,
          remainder: (amountIn - snapped).toString(),
        },
      },
    ];
  }

  /** GET with the public→JWT fallback described above. */
  private async get<T>(path: string): Promise<T> {
    const url = `${this.cfg.v3ApiUrl}${path}`;
    try {
      return await fetchJson<T>(url, { fetchImpl: this.opts.fetchImpl });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401 && this.opts.authHeaders) {
        const headers = await this.opts.authHeaders();
        return fetchJson<T>(url, { headers, fetchImpl: this.opts.fetchImpl });
      }
      if (e instanceof HttpError && e.status === 401)
        throw new Error("endpoint requires JWT and no V3 bot account is configured");
      throw e;
    }
  }
}

export function bookStatus(book: V3Book): VenueStatus {
  if (book.status !== "OPEN") return { ok: false, reason: `book ${book.id} is ${book.status}` };
  if (book.isMarketHalted === 1) return { ok: false, reason: `book ${book.id} is OPEN but market is halted` };
  return { ok: true };
}
