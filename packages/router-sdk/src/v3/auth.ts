import type { Hex } from "viem";
import type { NetworkConfig } from "../config";
import { fetchJson, HttpError } from "../http";
import { signChallenge, type RawSigner } from "./signing";

/**
 * SaucerSwap V3 Orderbook API session: challenge → sign → verify → JWT, renewed automatically on 401
 * and before every WebSocket connect. The JWT is short-lived (observed `exp` − `iat` = 6 h on testnet).
 */
export type V3Signer = {
  /** `0.0.x` (or the account's EVM address). */
  accountId: string;
  /** Signs raw bytes with the account key; for ECDSA/ED25519 bot keys wrap the Hiero SDK `PrivateKey.sign`. */
  sign: RawSigner;
};

export type V3AuthOptions = { fetchImpl?: typeof fetch; now?: () => number; renewBeforeMs?: number };

export class V3Auth {
  private token?: string;
  private expiresAt = 0;
  private inflight?: Promise<string>;

  constructor(
    private readonly cfg: NetworkConfig,
    private readonly signer: V3Signer,
    private readonly opts: V3AuthOptions = {},
  ) {}

  /** A valid JWT, authenticating when missing or close to expiry. */
  async token_(): Promise<string> {
    const now = (this.opts.now ?? Date.now)();
    if (this.token && now < this.expiresAt - (this.opts.renewBeforeMs ?? 60_000)) return this.token;
    if (!this.inflight) this.inflight = this.authenticate().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  /** Force a fresh session (after a 401, before a WebSocket reconnect). */
  async authenticate(): Promise<string> {
    const base = this.cfg.v3ApiUrl;
    const f = this.opts.fetchImpl;
    const { message } = await fetchJson<{ message: string }>(`${base}/auth/challenge`, {
      method: "POST",
      body: { accountId: this.signer.accountId },
      fetchImpl: f,
    });
    const signature: Hex = await signChallenge(message, this.signer.sign);
    const { token } = await fetchJson<{ token: string }>(`${base}/auth/verify`, {
      method: "POST",
      body: { accountId: this.signer.accountId, signature },
      fetchImpl: f,
    });
    this.token = token;
    this.expiresAt = jwtExpiryMs(token) ?? (this.opts.now ?? Date.now)() + 60 * 60 * 1000;
    return token;
  }

  async headers(): Promise<Record<string, string>> {
    return { Authorization: `Bearer ${await this.token_()}` };
  }

  /** Run an authenticated request; on 401 re-authenticate once and retry. */
  async withAuth<T>(fn: (headers: Record<string, string>) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.headers());
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        await this.authenticate();
        return fn(await this.headers());
      }
      throw e;
    }
  }

  /** The account the JWT was issued for (EVM address in `sub`), when known. */
  get subject(): string | undefined {
    return this.token ? jwtPayload(this.token)?.sub : undefined;
  }
}

function jwtPayload(token: string): { sub?: string; exp?: number } | undefined {
  try {
    const [, p] = token.split(".");
    if (!p) return undefined;
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return undefined;
  }
}

export const jwtExpiryMs = (token: string): number | undefined => {
  const exp = jwtPayload(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : undefined;
};

/** Build a signer from a Hiero SDK-style private key object (`sign(bytes)`), e.g. `PrivateKey.fromStringECDSA`. */
export const signerFromHieroKey = (accountId: string, key: { sign(bytes: Uint8Array): Uint8Array }): V3Signer => ({
  accountId,
  sign: b => key.sign(b),
});
