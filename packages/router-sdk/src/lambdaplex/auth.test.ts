import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadEd25519Key, signQuery } from "./auth";

/** Frozen vector: seed = 0x01 repeated; payload and base64 signature must never change. */
const SEED = "01".repeat(32);
const FROZEN_PAYLOAD = "symbol=HBAR-USDC&side=SELL&type=MARKET&quantity=100&recvWindow=5000&timestamp=1700000000000";
const FROZEN_SIG = "PaW0Uhbgqv8ma2Qz1l5hD9mYKLk+XQb15qCAsjFp7jBnAMMJbGIIhsV0GVIHl+/MkTmFSADoWs7TSF7mokXSAA==";

describe("Lambdaplex Signature V1", () => {
  it("signs the ordered query string with Ed25519 and matches the frozen vector", () => {
    const { query, headers } = signQuery(
      { symbol: "HBAR-USDC", side: "SELL", type: "MARKET", quantity: 100 },
      { apiKey: "key-1", ed25519Seed: SEED },
      { timestamp: 1_700_000_000_000 },
    );
    expect(headers).toEqual({ "X-API-KEY": "key-1" });
    expect(query).toBe(`${FROZEN_PAYLOAD}&signature=${encodeURIComponent(FROZEN_SIG)}`);
    const pub = createPublicKey(loadEd25519Key(SEED));
    expect(verify(null, Buffer.from(FROZEN_PAYLOAD), pub, Buffer.from(FROZEN_SIG, "base64"))).toBe(true);
  });

  it("loads hex seeds, base64 PKCS#8 and PEM to the same key", () => {
    const k1 = loadEd25519Key(SEED);
    const der = k1.export({ format: "der", type: "pkcs8" }) as Buffer;
    const k2 = loadEd25519Key(der.toString("base64"));
    const k3 = loadEd25519Key(k1.export({ format: "pem", type: "pkcs8" }) as string);
    const pem = (k: typeof k1) => k.export({ format: "pem", type: "pkcs8" });
    expect(pem(k2)).toBe(pem(k1));
    expect(pem(k3)).toBe(pem(k1));
    expect(pem(loadEd25519Key(`0x${SEED}`))).toBe(pem(k1));
    expect(() => loadEd25519Key("not a key")).toThrow();
  });

  it("uses the current time and default recvWindow when not given", () => {
    const { query } = signQuery({ a: "1" }, { apiKey: "k", ed25519Seed: SEED });
    expect(query).toMatch(/^a=1&recvWindow=5000&timestamp=\d{13}&signature=/);
  });
});
