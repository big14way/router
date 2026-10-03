import type { NetworkConfig } from "../config";
import type { V3Auth } from "./auth";
import { eventName, isTerminal, type OrderEvent, type V3Orders } from "./orders";

/**
 * `/ws/user-events` client. The JWT travels in the query string, so the URL is never logged; every
 * reconnect re-authenticates first. Falls back to polling `GET /orders/:id/history` when the socket
 * is unavailable, so `awaitTerminal` always resolves or times out.
 */
export type UserEvent = OrderEvent & { orderId?: string | number; id?: string | number };

export type WebSocketLike = {
  readyState: number;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  close(): void;
};

export type UserEventsOptions = {
  books: string[];
  wsFactory?: (url: string) => WebSocketLike;
  onEvent?: (e: UserEvent) => void;
  onStatus?: (s: "open" | "closed" | "error" | "reconnecting") => void;
  reconnectDelayMs?: number;
  maxReconnects?: number;
};

export class UserEvents {
  private ws?: WebSocketLike;
  private closed = false;
  private reconnects = 0;
  private readonly listeners = new Set<(e: UserEvent) => void>();

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly auth: V3Auth,
    private readonly opts: UserEventsOptions,
  ) {}

  async connect(): Promise<void> {
    const token = await this.auth.authenticate(); // always fresh before (re)connecting
    const url = `${this.cfg.v3WsUrl}/ws/user-events?token=${encodeURIComponent(token)}&books=${this.opts.books.join(",")}`;
    const factory = this.opts.wsFactory ?? (u => new WebSocket(u) as unknown as WebSocketLike);
    const ws = factory(url);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this.reconnects = 0;
        this.opts.onStatus?.("open");
        resolve();
      };
      ws.onerror = e => {
        this.opts.onStatus?.("error");
        reject(
          new Error(
            `user-events socket error${e && typeof e === "object" && "message" in e ? `: ${(e as { message: string }).message}` : ""}`,
          ),
        );
      };
      ws.onmessage = ev => this.dispatch(ev.data);
      ws.onclose = () => {
        this.opts.onStatus?.("closed");
        if (!this.closed) void this.reconnect();
      };
    });
  }

  private dispatch(data: unknown) {
    let parsed: unknown;
    try {
      parsed = typeof data === "string" ? JSON.parse(data) : data;
    } catch {
      return;
    }
    const events = Array.isArray(parsed) ? parsed : [parsed];
    for (const e of events as UserEvent[]) {
      this.opts.onEvent?.(e);
      for (const l of this.listeners) l(e);
    }
  }

  private async reconnect() {
    if (this.reconnects >= (this.opts.maxReconnects ?? 5)) return;
    this.reconnects += 1;
    this.opts.onStatus?.("reconnecting");
    await new Promise(r => setTimeout(r, this.opts.reconnectDelayMs ?? 1000));
    try {
      await this.connect();
    } catch {
      /* onclose will schedule the next attempt */
    }
  }

  subscribe(listener: (e: UserEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }
}

const idOf = (e: UserEvent): string | undefined => {
  // stream events: { type: "ORDER_CANCELED", orderId: "3539170", … }
  const raw =
    e.orderId ??
    e.id ??
    (e.order as { id?: string | number; meta?: { id?: string | number } } | undefined)?.id ??
    (e.order as { meta?: { id?: string | number } } | undefined)?.meta?.id;
  return raw === undefined ? undefined : String(raw);
};

/**
 * Resolve when the order reaches a terminal event (`ORDER_FILLED`, `ORDER_CANCELED`, …) on the
 * event stream or in `GET /orders/:id/history`; reject on timeout.
 */
export async function awaitTerminal(
  orders: V3Orders,
  orderId: string | number,
  opts: { events?: UserEvents; timeoutMs?: number; pollMs?: number; now?: () => number } = {},
): Promise<OrderEvent> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollMs = opts.pollMs ?? 5_000;
  const started = (opts.now ?? Date.now)();
  return new Promise<OrderEvent>((resolve, reject) => {
    let done = false;
    const finish = (e: OrderEvent) => {
      if (done) return;
      done = true;
      unsubscribe?.();
      clearInterval(timer);
      resolve(e);
    };
    const unsubscribe = opts.events?.subscribe(e => {
      if (idOf(e) === String(orderId) && isTerminal(e)) finish(e);
    });
    const poll = async () => {
      if (done) return;
      if ((opts.now ?? Date.now)() - started > timeoutMs) {
        done = true;
        unsubscribe?.();
        clearInterval(timer);
        reject(new Error(`order ${orderId} did not reach a terminal state within ${timeoutMs} ms`));
        return;
      }
      const history = await orders.history(orderId).catch(() => [] as OrderEvent[]);
      const terminal = history.find(isTerminal);
      if (terminal) finish(terminal);
    };
    const timer = setInterval(() => void poll(), pollMs);
    void poll();
  });
}

export { eventName };
