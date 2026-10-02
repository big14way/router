import { describe, expect, it } from "vitest";
import type { Quote, VenueReport } from "../types";
import { rankQuotes, routeKey } from "./rank";

const q = (venue: Quote["venue"], amountOut: bigint, over: Partial<Quote> = {}): Quote => ({
  venue,
  amountIn: 1_000n,
  amountOut,
  fillable: true,
  minNotionalOk: true,
  fetchedAt: 0,
  path: venue === "SAUCER_V1" ? ["0xA", "0xB"] : "0xabc",
  bookId: "1",
  symbol: "HBAR-USDC",
  side: "SELL",
  ...over,
});
const rep = (venue: Quote["venue"], quotes: Quote[], ok = true, reason?: string): VenueReport => ({
  venue,
  status: { ok, reason },
  quotes,
  latencyMs: 1,
});

describe("rankQuotes", () => {
  it("sorts executable quotes by output and explains exclusions", () => {
    const r = rankQuotes([
      rep("SAUCER_V1", [q("SAUCER_V1", 100n), q("SAUCER_V1", 90n, { fillable: false })]),
      rep("SAUCER_V2", [q("SAUCER_V2", 120n), q("SAUCER_V2", 0n)]),
      rep("LAMBDAPLEX", [q("LAMBDAPLEX", 130n)], false, "quote-only"),
      rep("SAUCER_V3", [q("SAUCER_V3", 125n, { minNotionalOk: false })]),
    ]);
    expect(r.ranked.map(x => [x.venue, x.amountOut])).toEqual([
      ["SAUCER_V2", 120n],
      ["SAUCER_V1", 100n],
    ]);
    expect(r.bestAmm?.amountOut).toBe(120n);
    expect(r.excluded.map(e => e.reason)).toEqual([
      "not fillable for this size",
      "zero output",
      "quote-only",
      "below venue minimum notional",
    ]);
  });

  it("applies the V3 5 bps rule against the best AMM", () => {
    const amm = rep("SAUCER_V2", [q("SAUCER_V2", 1_000_000n)]);
    const tooClose = rankQuotes([amm, rep("SAUCER_V3", [q("SAUCER_V3", 1_000_400n)])]);
    expect(tooClose.ranked[0]!.venue).toBe("SAUCER_V2");
    expect(tooClose.excluded[0]!.reason).toBe("V3 output not ≥ best AMM + 5 bps");
    const wins = rankQuotes([amm, rep("SAUCER_V3", [q("SAUCER_V3", 1_000_500n)])]);
    expect(wins.ranked[0]!.venue).toBe("SAUCER_V3");
    const custom = rankQuotes([amm, rep("SAUCER_V3", [q("SAUCER_V3", 1_000_500n)])], { v3EdgeBps: 10 });
    expect(custom.ranked[0]!.venue).toBe("SAUCER_V2");
    const noAmm = rankQuotes([rep("SAUCER_V3", [q("SAUCER_V3", 5n)])]);
    expect(noAmm.ranked).toHaveLength(1);
  });

  it("lets Lambdaplex compete on the same all-in basis", () => {
    const r = rankQuotes([
      rep("SAUCER_V1", [q("SAUCER_V1", 100n)]),
      rep("LAMBDAPLEX", [q("LAMBDAPLEX", 101n, { feeOut: 1n })]),
    ]);
    expect(r.ranked[0]!.venue).toBe("LAMBDAPLEX");
  });

  it("derives stable route keys", () => {
    expect(routeKey(q("SAUCER_V1", 1n))).toBe("V1:0xa>0xb");
    expect(routeKey(q("SAUCER_V2", 1n))).toBe("V2:0xabc");
    expect(routeKey(q("SAUCER_V3", 1n))).toBe("V3:1:SELL");
    expect(routeKey(q("LAMBDAPLEX", 1n))).toBe("LP:HBAR-USDC:SELL");
  });
});
