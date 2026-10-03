import type { Address, Hex } from "viem";
import type { NetworkConfig } from "../config";
import { fetchJson, TtlCache } from "../http";
import type { V3Book, V3ExactInputQuote } from "../venues/SaucerV3";
import { bookStatus } from "../venues/SaucerV3";
import type { V3Auth } from "./auth";
import { extractOrder, type V3Domain, type V3Order } from "./signing";

/**
 * Order lifecycle against the Orderbook API: quote → build (server assigns the nonce) → sign the
 * *returned* struct → save → track (user events / history) → cancel. All integers stay strings.
 */
export type OrderType = "LIMIT" | "MARKET";

export type BuildRequest = {
  orderbookId: string;
  type: OrderType;
  /** LIMIT only, unix seconds. */
  deadline?: string;
  inputToken: Address;
  inputAmount: string;
  outputToken: Address;
  outputAmount: string;
  recipient?: Address;
  makerOnly?: boolean;
  takerOnce?: boolean;
  isAMMEnabled?: boolean;
};

export type BuiltOrder = V3Order & { meta?: Record<string, unknown> };

export type SavedOrder = {
  info?: { nonce?: string };
  meta?: { id?: number | string; status?: string; [k: string]: unknown };
  [k: string]: unknown;
};

export type OrderSigner = (order: V3Order, domain: V3Domain) => Promise<Hex>;

export class V3Orders {
  private readonly domainCache = new TtlCache<V3Domain>(10 * 60 * 1000);

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly auth: V3Auth,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  private get base() {
    return this.cfg.v3ApiUrl;
  }

  /** Signing domain, fetched at runtime and cached for the session (the reactor can change per environment). */
  async domain(): Promise<V3Domain> {
    const hit = this.domainCache.get("d");
    if (hit) return hit;
    return this.domainCache.set(
      "d",
      await fetchJson<V3Domain>(`${this.base}/signature/domain`, { fetchImpl: this.fetchImpl }),
    );
  }

  async books(): Promise<V3Book[]> {
    return (await fetchJson<{ orderbooks: V3Book[] }>(`${this.base}/books`, { fetchImpl: this.fetchImpl })).orderbooks;
  }

  /** Fresh (authenticated) exact-input quote. */
  async quoteExactInput(bookId: string, inputToken: Address, inputAmount: string): Promise<V3ExactInputQuote> {
    return this.auth.withAuth(h =>
      fetchJson<V3ExactInputQuote>(
        `${this.base}/books/${bookId}/quote/exact-input?inputToken=${inputToken}&inputAmount=${inputAmount}`,
        { headers: h, fetchImpl: this.fetchImpl },
      ),
    );
  }

  /** `POST /orders/build` — returns the serialized order structs to sign (never sign your request). */
  async build(requests: BuildRequest[]): Promise<BuiltOrder[]> {
    const res = await this.auth.withAuth(h =>
      fetchJson<{ orders: Record<string, unknown>[] }>(`${this.base}/orders/build`, {
        method: "POST",
        body: { orderRequests: requests },
        headers: h,
        fetchImpl: this.fetchImpl,
      }),
    );
    return res.orders.map(o => ({ ...extractOrder(o), meta: o.meta as Record<string, unknown> | undefined }));
  }

  /** `POST /orders/save` with mode-prefixed signatures. */
  async save(
    items: { order: BuiltOrder; signature: Hex; orderbookId: string; type: OrderType }[],
  ): Promise<SavedOrder[]> {
    const body = {
      items: items.map(i => ({
        order: stripMeta(i.order),
        signature: i.signature,
        orderbookId: i.orderbookId,
        type: i.type,
      })),
    };
    const res = await this.auth.withAuth(h =>
      fetchJson<{ orders: SavedOrder[] }>(`${this.base}/orders/save`, {
        method: "POST",
        body,
        headers: h,
        fetchImpl: this.fetchImpl,
      }),
    );
    return res.orders;
  }

  /** Build, sign and save one order; returns the saved order with `meta.status`. */
  async place(
    request: BuildRequest,
    sign: OrderSigner,
  ): Promise<{ built: BuiltOrder; signature: Hex; saved: SavedOrder }> {
    const [built] = await this.build([request]);
    if (!built) throw new Error("build returned no order");
    const signature = await sign(built, await this.domain());
    const [saved] = await this.save([
      { order: built, signature, orderbookId: request.orderbookId, type: request.type },
    ]);
    if (!saved) throw new Error("save returned no order");
    return { built, signature, saved };
  }

  /**
   * Market order the way SaucerSwap's app does it: re-quote immediately, require `fillable`, submit
   * `snappedInputAmount` + `suggestedOutputAmount`, allow AMM-backed settlement.
   */
  async quoteThenBuildMarket(
    book: V3Book,
    inputToken: Address,
    inputAmount: string,
    recipient?: Address,
  ): Promise<{ quote: V3ExactInputQuote; request: BuildRequest }> {
    const status = bookStatus(book);
    if (!status.ok) throw new Error(status.reason);
    const quote = await this.quoteExactInput(book.id, inputToken, inputAmount);
    if (!quote.fillable) throw new Error(`book ${book.id} cannot fill ${inputAmount} of ${inputToken} right now`);
    if (quote.suggestedOutputAmount === "1")
      throw new Error("quote suggests outputAmount 1: no price protection, refusing");
    const outputToken =
      inputToken.toLowerCase() === book.baseTokenEvmAddress.toLowerCase()
        ? (book.quoteTokenEvmAddress as Address)
        : (book.baseTokenEvmAddress as Address);
    const request: BuildRequest = {
      orderbookId: book.id,
      type: "MARKET",
      inputToken,
      inputAmount: quote.snappedInputAmount,
      outputToken,
      outputAmount: quote.suggestedOutputAmount,
      recipient,
      isAMMEnabled: true,
    };
    return { quote, request };
  }

  buildLimitRequest(
    book: V3Book,
    inputToken: Address,
    inputAmount: string,
    outputAmount: string,
    deadlineSeconds: number,
    opts: { recipient?: Address; makerOnly?: boolean; isAMMEnabled?: boolean } = {},
  ): BuildRequest {
    const outputToken =
      inputToken.toLowerCase() === book.baseTokenEvmAddress.toLowerCase()
        ? (book.quoteTokenEvmAddress as Address)
        : (book.baseTokenEvmAddress as Address);
    return {
      orderbookId: book.id,
      type: "LIMIT",
      deadline: String(Math.floor(Date.now() / 1000) + deadlineSeconds),
      inputToken,
      inputAmount,
      outputToken,
      outputAmount,
      recipient: opts.recipient,
      makerOnly: opts.makerOnly,
      isAMMEnabled: opts.isAMMEnabled ?? true,
    };
  }

  async list(
    params: { orderbookId?: string; status?: string; page?: number; limit?: number } = {},
  ): Promise<{ orders: SavedOrder[]; total: number }> {
    const q = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    );
    return this.auth.withAuth(h =>
      fetchJson(`${this.base}/orders${q.size ? `?${q}` : ""}`, { headers: h, fetchImpl: this.fetchImpl }),
    );
  }

  async history(orderId: string | number): Promise<OrderEvent[]> {
    const res = await this.auth.withAuth(h =>
      fetchJson<{ events?: OrderEvent[]; history?: OrderEvent[] } | OrderEvent[]>(
        `${this.base}/orders/${orderId}/history`,
        { headers: h, fetchImpl: this.fetchImpl },
      ),
    );
    return Array.isArray(res) ? res : (res.events ?? res.history ?? []);
  }

  /** Asynchronous: 202 means accepted. Confirm `ORDER_CANCELED` through `awaitTerminal` / user events. */
  async cancel(orderIds: (string | number)[]): Promise<unknown> {
    return this.auth.withAuth(h =>
      fetchJson(`${this.base}/cancel`, { method: "POST", body: { orderIds }, headers: h, fetchImpl: this.fetchImpl }),
    );
  }

  async cancelAll(nonceFloor: string): Promise<unknown> {
    return this.auth.withAuth(h =>
      fetchJson(`${this.base}/cancel/all`, {
        method: "POST",
        body: { nonceFloor },
        headers: h,
        fetchImpl: this.fetchImpl,
      }),
    );
  }

  async fees(bookId: string, side: "taker" | "maker"): Promise<{ takerFeePips?: number; makerFeePips?: number }> {
    return this.auth.withAuth(h =>
      fetchJson(`${this.base}/fees/${bookId}?side=${side}`, { headers: h, fetchImpl: this.fetchImpl }),
    );
  }

  /** Recent fills on a book (public). */
  async trades(
    bookId: string,
    limit = 20,
  ): Promise<{
    trades: { timestamp: number; price: string; amountBase: string; direction: string; transactionHash: string }[];
  }> {
    return fetchJson(`${this.base}/trades/${bookId}?limit=${limit}&sort=desc`, { fetchImpl: this.fetchImpl });
  }
}

export type OrderEvent = {
  type?: string;
  event?: string;
  status?: string;
  timestamp?: number | string;
  transactionHash?: string;
  txHash?: string;
  [k: string]: unknown;
};

export const TERMINAL_EVENTS = [
  "ORDER_FILLED",
  "ORDER_CANCELED",
  "ORDER_CANCELLED",
  "ORDER_EXPIRED",
  "ORDER_REJECTED",
  "ORDER_FAILED",
];

export const eventName = (e: OrderEvent): string => String(e.type ?? e.event ?? e.status ?? "").toUpperCase();

export const isTerminal = (e: OrderEvent): boolean => TERMINAL_EVENTS.includes(eventName(e));

const stripMeta = (o: BuiltOrder): V3Order => {
  const { meta: _meta, ...rest } = o;
  void _meta;
  return rest;
};
