import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { getConfig } from "./config";
import { ethCall, publicClients } from "./evm";

const client = (impl: () => Promise<{ data?: `0x${string}` }>): PublicClient =>
  ({ call: impl }) as unknown as PublicClient;
const cfg = getConfig("mainnet");

describe("ethCall failover", () => {
  it("uses the first relay that answers", async () => {
    const bad = client(async () => {
      throw new Error("Invalid request");
    });
    const good = client(async () => ({ data: "0x01" }));
    expect(await ethCall(cfg, [bad, good], "0x01", "0x02")).toBe("0x01");
  });

  it("falls back to the mirror node and reports every failure", async () => {
    const bad = client(async () => ({ data: undefined }));
    const mirror = (async () => new Response(JSON.stringify({ result: "0xaa" }), { status: 200 })) as typeof fetch;
    expect(await ethCall(cfg, [bad], "0x01", "0x02", { fetchImpl: mirror, gas: 5n })).toBe("0xaa");
    const mirrorDown = (async () => new Response('{"_status":{}}', { status: 429 })) as typeof fetch;
    await expect(ethCall(cfg, [bad], "0x01", "0x02", { fetchImpl: mirrorDown })).rejects.toThrow(
      /every endpoint: empty result \| mirror: HTTP 429/,
    );
    const mirrorEmpty = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    await expect(ethCall(cfg, [], "0x01", "0x02", { fetchImpl: mirrorEmpty })).rejects.toThrow(/mirror: no result/);
  });

  it("builds one client per configured relay", () => {
    expect(publicClients(cfg)).toHaveLength(1 + cfg.fallbackRpcUrls.length);
  });
});
