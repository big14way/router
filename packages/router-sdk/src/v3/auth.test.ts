import { describe, expect, it } from "vitest";
import { getConfig } from "../config";
import { HttpError } from "../http";
import { fakeFetch } from "../venues/testkit";
import { jwtExpiryMs, signerFromHieroKey, V3Auth } from "./auth";

const cfg = getConfig("testnet");
const jwt = (exp: number) => `h.${Buffer.from(JSON.stringify({ sub: "0xabc", exp })).toString("base64url")}.s`;
const signer = { accountId: "0.0.5", sign: (b: Uint8Array) => new Uint8Array([b.length & 0xff, 1, 2]) };

describe("V3Auth", () => {
  it("challenges, signs the personal-sign bytes, verifies and caches the token until near expiry", async () => {
    const seen: string[] = [];
    const fetchImpl = fakeFetch({
      "/auth/challenge": { body: { message: "Sign this message from SaucerSwap. Nonce: n1" } },
      "/auth/verify": (_u, init) => {
        seen.push(String(init?.body));
        return { body: { token: jwt(Math.floor(Date.now() / 1000) + 3600) } };
      },
    });
    const auth = new V3Auth(cfg, signer, { fetchImpl });
    const h = await auth.headers();
    expect(h.Authorization).toMatch(/^Bearer h\./);
    const prefixed = "\x19Hedera Signed Message:\n45Sign this message from SaucerSwap. Nonce: n1";
    expect(JSON.parse(seen[0]!)).toEqual({
      accountId: "0.0.5",
      signature: `0x${(prefixed.length & 0xff).toString(16).padStart(2, "0")}0102`,
    });
    await auth.headers();
    expect(fetchImpl.calls.filter(u => u.includes("/auth/verify"))).toHaveLength(1);
    expect(auth.subject).toBe("0xabc");
  });

  it("renews when expired, retries once on 401, and dedupes concurrent authentications", async () => {
    let exp = Math.floor(Date.now() / 1000) + 10; // inside the renew window → next call re-authenticates
    let verifies = 0;
    const fetchImpl = fakeFetch({
      "/auth/challenge": { body: { message: "m" } },
      "/auth/verify": () => {
        verifies += 1;
        return { body: { token: jwt(exp) } };
      },
    });
    const auth = new V3Auth(cfg, signer, { fetchImpl });
    await Promise.all([auth.token_(), auth.token_()]);
    expect(verifies).toBe(1);
    exp = Math.floor(Date.now() / 1000) + 7200;
    let calls = 0;
    const res = await auth.withAuth(async h => {
      calls += 1;
      if (calls === 1) throw new HttpError(401, "/orders", "expired");
      return h.Authorization;
    });
    expect(res).toMatch(/^Bearer /);
    expect(verifies).toBeGreaterThanOrEqual(2);
    await expect(
      auth.withAuth(async () => {
        throw new Error("other");
      }),
    ).rejects.toThrow("other");
    await expect(
      auth.withAuth(async () => {
        throw new HttpError(401, "/x", "still");
      }),
    ).rejects.toThrow(/401/);
  });

  it("parses jwt expiry and falls back when the token is opaque", async () => {
    expect(jwtExpiryMs(jwt(100))).toBe(100_000);
    expect(jwtExpiryMs("opaque")).toBeUndefined();
    const s = signerFromHieroKey("0.0.9", { sign: b => new Uint8Array(b.length) });
    expect(s.accountId).toBe("0.0.9");
    expect(await s.sign(new Uint8Array(3))).toHaveLength(3);
    const opaque = new V3Auth(cfg, signer, {
      fetchImpl: fakeFetch({
        "/auth/challenge": { body: { message: "m" } },
        "/auth/verify": { body: { token: "opaque" } },
      }),
      now: () => 1000,
    });
    expect(await opaque.token_()).toBe("opaque");
    expect(opaque.subject).toBeUndefined();
  });
});
