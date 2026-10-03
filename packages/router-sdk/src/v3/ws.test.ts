import { describe, expect, it } from "vitest";
import { getConfig } from "../config";
import type { V3Auth } from "./auth";
import type { OrderEvent, V3Orders } from "./orders";
import { awaitTerminal, UserEvents, type WebSocketLike } from "./ws";

const cfg = getConfig("testnet");

class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(public url: string) {}
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(data: unknown) {
    this.onmessage?.({ data: typeof data === "string" ? data : JSON.stringify(data) });
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

const authWith = (tokens: string[]) => {
  let i = 0;
  return { authenticate: async () => tokens[Math.min(i++, tokens.length - 1)]! } as unknown as V3Auth;
};

describe("UserEvents", () => {
  it("re-authenticates before connecting, carries the token in the query, dispatches events, reconnects", async () => {
    const sockets: FakeSocket[] = [];
    const seen: unknown[] = [];
    const status: string[] = [];
    const ue = new UserEvents(cfg, authWith(["t1", "t2"]), {
      books: ["1", "3"],
      wsFactory: u => {
        const s = new FakeSocket(u);
        sockets.push(s);
        queueMicrotask(() => s.open());
        return s;
      },
      onEvent: e => seen.push(e),
      onStatus: s => status.push(s),
      reconnectDelayMs: 1,
    });
    await ue.connect();
    expect(sockets[0]!.url).toBe(`${cfg.v3WsUrl}/ws/user-events?token=t1&books=1,3`);
    sockets[0]!.emit({ type: "ORDER_PLACED", orderId: 5 });
    sockets[0]!.emit([{ type: "ORDER_FILLED", orderId: 5 }]);
    sockets[0]!.emit("not json");
    expect(seen).toHaveLength(2);
    sockets[0]!.onclose?.({ code: 1006 }); // dropped → reconnect with a fresh token
    await new Promise(r => setTimeout(r, 20));
    expect(sockets).toHaveLength(2);
    expect(sockets[1]!.url).toContain("token=t2");
    expect(status).toEqual(["open", "closed", "reconnecting", "open"]);
    ue.close();
    await new Promise(r => setTimeout(r, 20));
    expect(sockets).toHaveLength(2); // explicit close does not reconnect
  });

  it("rejects when the socket errors", async () => {
    const ue = new UserEvents(cfg, authWith(["t"]), {
      books: ["1"],
      wsFactory: u => {
        const s = new FakeSocket(u);
        queueMicrotask(() => s.onerror?.({ message: "boom" }));
        return s;
      },
    });
    await expect(ue.connect()).rejects.toThrow(/socket error: boom/);
  });
});

describe("awaitTerminal", () => {
  const ordersWith = (histories: OrderEvent[][]) => {
    let i = 0;
    return { history: async () => histories[Math.min(i++, histories.length - 1)]! } as unknown as V3Orders;
  };

  it("resolves from the event stream", async () => {
    const sockets: FakeSocket[] = [];
    const ue = new UserEvents(cfg, authWith(["t"]), {
      books: ["3"],
      wsFactory: u => {
        const s = new FakeSocket(u);
        sockets.push(s);
        queueMicrotask(() => s.open());
        return s;
      },
    });
    await ue.connect();
    const p = awaitTerminal(ordersWith([[]]), 7, { events: ue, timeoutMs: 5000, pollMs: 1000 });
    sockets[0]!.emit({ type: "ORDER_PLACED", orderId: 7 });
    sockets[0]!.emit({ type: "ORDER_CANCELED", order: { meta: { id: 7 } } });
    expect((await p).type).toBe("ORDER_CANCELED");
    ue.close();
  });

  it("falls back to polling history and times out", async () => {
    const e = await awaitTerminal(
      ordersWith([[{ type: "CREATED" }], [{ type: "CREATED" }, { status: "FILLED", txHash: "0x9" }]]),
      "7",
      { timeoutMs: 5000, pollMs: 5 },
    );
    expect(e).toMatchObject({ status: "FILLED" });
    let t = 0;
    await expect(awaitTerminal(ordersWith([[]]), 1, { timeoutMs: 10, pollMs: 2, now: () => (t += 6) })).rejects.toThrow(
      /terminal state/,
    );
  });
});
