import { describe, expect, it } from "vitest";
import { getConfig } from "../config";
import type { V3Book } from "../venues/SaucerV3";
import { fakeFetch } from "../venues/testkit";
import type { V3Auth } from "./auth";
import { eventName, isTerminal, V3Orders, type BuiltOrder } from "./orders";

const cfg = getConfig("testnet");
const auth = {
  withAuth: async (fn: (h: Record<string, string>) => Promise<unknown>) => fn({ Authorization: "Bearer t" }),
} as unknown as V3Auth;
const book: V3Book = {
  id: "3",
  baseTokenId: "0.0.1183558",
  quoteTokenId: "0.0.5449",
  baseTokenEvmAddress: "0x0000000000000000000000000000000000120f46",
  quoteTokenEvmAddress: "0x0000000000000000000000000000000000001549",
  status: "OPEN",
  isAMMEnabled: 1,
  isMarketHalted: 0,
  baseTokenSymbol: "SAUCE",
  quoteTokenSymbol: "USDC",
  baseTokenDecimals: 6,
  quoteTokenDecimals: 6,
  tickStep: "0.00001",
  sizeStep: "0.1",
  lotSize: "100000",
  minNotional: "1",
};
const domain = {
  name: "PartialFillLimitOrderReactor",
  version: "1",
  chainId: 296,
  verifyingContract: "0x5707B946EE64bD750A587261Ce36ec7024F3088B",
};
const apiOrder = {
  info: {
    reactor: domain.verifyingContract,
    swapper: "0xf334ebbf2a14108c324e22aec7b421a87aae6039",
    nonce: "1",
    deadline: "1791018791",
    additionalValidationContract: "0xd1a45eba17b05cc62b11e2b62b8a00651a79014c",
    additionalValidationData: "0x",
  },
  input: { token: book.quoteTokenEvmAddress, amount: "1000000" },
  output: {
    token: book.baseTokenEvmAddress,
    amount: "1000000000",
    recipient: "0xf334ebbf2a14108c324e22aec7b421a87aae6039",
  },
  makerOnly: false,
  takerOnce: false,
  maxTakerFeePips: 2000,
  maxMakerFeePips: 2000,
  meta: { isAMMEnabled: true },
};

describe("V3Orders", () => {
  it("builds with orderRequests, signs the returned struct, saves without meta", async () => {
    const bodies: Record<string, unknown> = {};
    const fetchImpl = fakeFetch({
      "/signature/domain": { body: domain },
      "/orders/build": (_u, init) => {
        bodies.build = JSON.parse(String(init?.body));
        return { body: { orders: [apiOrder] } };
      },
      "/orders/save": (_u, init) => {
        bodies.save = JSON.parse(String(init?.body));
        return { body: { orders: [{ info: { nonce: "1" }, meta: { id: 42, status: "OPEN" } }] } };
      },
    });
    const orders = new V3Orders(cfg, auth, fetchImpl);
    const req = orders.buildLimitRequest(
      book,
      book.quoteTokenEvmAddress as `0x${string}`,
      "1000000",
      "1000000000",
      3600,
    );
    expect(req).toMatchObject({
      orderbookId: "3",
      type: "LIMIT",
      outputToken: book.baseTokenEvmAddress,
      isAMMEnabled: true,
    });
    expect(Number(req.deadline)).toBeGreaterThan(Date.now() / 1000);
    const signed: BuiltOrder[] = [];
    const r = await orders.place(req, async (o, d) => {
      signed.push(o);
      expect(d).toEqual(domain);
      return "0x00ab";
    });
    expect((bodies.build as { orderRequests: unknown[] }).orderRequests).toHaveLength(1);
    expect(signed[0]!.info.nonce).toBe("1");
    const saveBody = bodies.save as {
      items: { order: Record<string, unknown>; signature: string; orderbookId: string; type: string }[];
    };
    expect(saveBody.items[0]).toMatchObject({ signature: "0x00ab", orderbookId: "3", type: "LIMIT" });
    expect(saveBody.items[0]!.order.meta).toBeUndefined();
    expect(saveBody.items[0]!.order.info).toEqual(apiOrder.info);
    expect(r.saved.meta?.id).toBe(42);
    await orders.domain();
    expect(fetchImpl.calls.filter(u => u.includes("/signature/domain"))).toHaveLength(1);
  });

  it("market orders re-quote and refuse unfillable or unprotected quotes", async () => {
    const fetchImpl = fakeFetch({
      "/books/3/quote/exact-input": url =>
        url.includes("inputAmount=5")
          ? {
              body: {
                outputToken: book.baseTokenEvmAddress,
                snappedInputAmount: "5",
                consumedInputAmount: "5",
                expectedOutputAmount: "9",
                suggestedOutputAmount: "1",
                slippageBps: 500,
                fillable: true,
              },
            }
          : url.includes("inputAmount=7")
            ? {
                body: {
                  outputToken: book.baseTokenEvmAddress,
                  snappedInputAmount: "7",
                  consumedInputAmount: "0",
                  expectedOutputAmount: "0",
                  suggestedOutputAmount: "1",
                  slippageBps: 500,
                  fillable: false,
                },
              }
            : {
                body: {
                  outputToken: book.baseTokenEvmAddress,
                  snappedInputAmount: "1000000",
                  consumedInputAmount: "1000000",
                  expectedOutputAmount: "900",
                  suggestedOutputAmount: "850",
                  slippageBps: 500,
                  fillable: true,
                },
              },
    });
    const orders = new V3Orders(cfg, auth, fetchImpl);
    const { request } = await orders.quoteThenBuildMarket(book, book.quoteTokenEvmAddress as `0x${string}`, "1000123");
    expect(request).toEqual({
      orderbookId: "3",
      type: "MARKET",
      inputToken: book.quoteTokenEvmAddress,
      inputAmount: "1000000",
      outputToken: book.baseTokenEvmAddress,
      outputAmount: "850",
      recipient: undefined,
      isAMMEnabled: true,
    });
    await expect(orders.quoteThenBuildMarket(book, book.quoteTokenEvmAddress as `0x${string}`, "7")).rejects.toThrow(
      /cannot fill/,
    );
    await expect(orders.quoteThenBuildMarket(book, book.quoteTokenEvmAddress as `0x${string}`, "5")).rejects.toThrow(
      /outputAmount 1/,
    );
    await expect(
      orders.quoteThenBuildMarket({ ...book, isMarketHalted: 1 }, book.quoteTokenEvmAddress as `0x${string}`, "1"),
    ).rejects.toThrow(/halted/);
  });

  it("lists, reads history in either shape, cancels, reads fees and trades", async () => {
    const fetchImpl = fakeFetch({
      "/orders/9/history": { body: { events: [{ type: "ORDER_PLACED" }, { type: "ORDER_CANCELED" }] } },
      "/orders/8/history": { body: [{ event: "order_filled", transactionHash: "0x1" }] },
      "/orders?orderbookId=3&status=OPEN": { body: { orders: [{ meta: { id: 1 } }], total: 1 } },
      "/orders": { body: { orders: [], total: 0 } },
      "/cancel/all": { body: { accepted: true } },
      "/cancel": { status: 202, body: { accepted: [9] } },
      "/fees/3?side=taker": { body: { takerFeePips: 2000 } },
      "/trades/3": { body: { trades: [{ transactionHash: "0xt" }] } },
      "/books": { body: { orderbooks: [book] } },
    });
    const orders = new V3Orders(cfg, auth, fetchImpl);
    expect((await orders.list({ orderbookId: "3", status: "OPEN" })).total).toBe(1);
    expect((await orders.list()).orders).toEqual([]);
    const h = await orders.history(9);
    expect(h.map(eventName)).toEqual(["ORDER_PLACED", "ORDER_CANCELED"]);
    expect(isTerminal(h[1]!)).toBe(true);
    expect(isTerminal(h[0]!)).toBe(false);
    expect((await orders.history(8))[0]).toMatchObject({ transactionHash: "0x1" });
    expect(await orders.cancel([9])).toEqual({ accepted: [9] });
    expect(await orders.cancelAll("100")).toEqual({ accepted: true });
    expect(await orders.fees("3", "taker")).toEqual({ takerFeePips: 2000 });
    expect((await orders.trades("3")).trades[0]!.transactionHash).toBe("0xt");
    expect((await orders.books())[0]!.id).toBe("3");
  });
});
