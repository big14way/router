import { describe, expect, it } from "vitest";
import { getConfig } from "../config";
import type { Quote, Token } from "../types";
import { allQuotes, createVenues, quoteAll, VENUE_ORDER } from "./index";
import { fakeClient, fakeFetch, HBAR, SAUCE, USDC, WHBAR } from "./testkit";
import type { Venue } from "./Venue";

const stub = (name: Venue["name"], impl: Partial<Venue>): Venue => ({
  name,
  canExecute: async () => ({ ok: true }),
  quoteExactInput: async () => [],
  ...impl,
});

describe("quoteAll", () => {
  it("turns throws and timeouts into reports and never rejects", async () => {
    const q: Quote = {
      venue: "SAUCER_V1",
      amountIn: 1n,
      amountOut: 2n,
      fillable: true,
      minNotionalOk: true,
      fetchedAt: 0,
    };
    const venues = [
      stub("SAUCER_V1", { quoteExactInput: async () => [q] }),
      stub("SAUCER_V2", {
        quoteExactInput: async () => {
          throw new Error("rpc down");
        },
      }),
      stub("SAUCER_V3", { quoteExactInput: () => new Promise(() => {}) }),
    ];
    const reports = await quoteAll(venues, WHBAR as Token, SAUCE as Token, 1n, 20);
    expect(reports.map(r => r.venue)).toEqual(["SAUCER_V1", "SAUCER_V2", "SAUCER_V3"]);
    expect(reports[0]!.quotes).toEqual([q]);
    expect(reports[1]!.status).toEqual({ ok: false, reason: "rpc down" });
    expect(reports[2]!.status.reason).toMatch(/timed out after 20 ms/);
    expect(allQuotes(reports)).toEqual([q]);
  });
});

describe("createVenues", () => {
  it("builds all four adapters in a fixed order", () => {
    const venues = createVenues(getConfig("testnet"), {
      clients: [fakeClient(() => undefined)],
      fetchImpl: fakeFetch({}),
    });
    expect(venues.map(v => v.name)).toEqual(VENUE_ORDER);
  });

  it("marks Lambdaplex keyed when credentials are passed", async () => {
    const venues = createVenues(getConfig("mainnet"), {
      clients: [fakeClient(() => undefined)],
      fetchImpl: fakeFetch({ "/api/v1/exchangeInfo": { body: { exchangeSymbols: [] } } }),
      lambdaplex: { credentials: { apiKey: "k", ed25519Seed: "01".repeat(32) } },
    });
    expect((await venues[3]!.canExecute(HBAR, USDC)).reason).toBe("no Lambdaplex symbol for this pair");
  });
});
