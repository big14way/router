import { createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * Lambdaplex "Signature V1": Ed25519 over the ordered query string (`k=v&k=v`, insertion order,
 * `recvWindow` and `timestamp` appended last), base64 signature sent as the `signature` parameter,
 * API key in the `X-API-KEY` header. Mirrors the Hummingbot reference connector.
 */
export type LambdaplexCredentials = { apiKey: string; ed25519Seed: string };

export const DEFAULT_RECV_WINDOW_MS = 5_000;

/** PKCS#8 DER prefix for an Ed25519 private key (RFC 8410). */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Accepts a 32-byte hex seed, a base64 PKCS#8 body, or a full PEM block. */
export function loadEd25519Key(secret: string): KeyObject {
  const s = secret.trim().replace(/\\n/g, "\n");
  if (s.includes("BEGIN")) return createPrivateKey({ key: s, format: "pem" });
  const hex = s.replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    return createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(hex, "hex")]),
      format: "der",
      type: "pkcs8",
    });
  }
  return createPrivateKey({ key: Buffer.from(s.replace(/\s+/g, ""), "base64"), format: "der", type: "pkcs8" });
}

export type SignedRequest = { query: string; headers: Record<string, string> };

/** Build the signed query string for a Signature V1 request. `params` keep their insertion order. */
export function signQuery(
  params: Record<string, string | number | boolean>,
  creds: LambdaplexCredentials,
  opts: { timestamp?: number; recvWindow?: number; key?: KeyObject } = {},
): SignedRequest {
  const key = opts.key ?? loadEd25519Key(creds.ed25519Seed);
  const ordered: [string, string][] = Object.entries(params).map(([k, v]) => [k, String(v)]);
  ordered.push(["recvWindow", String(opts.recvWindow ?? DEFAULT_RECV_WINDOW_MS)]);
  ordered.push(["timestamp", String(opts.timestamp ?? Date.now())]);
  const payload = ordered.map(([k, v]) => `${k}=${v}`).join("&");
  const signature = sign(null, Buffer.from(payload, "utf8"), key).toString("base64");
  const query = `${payload}&signature=${encodeURIComponent(signature)}`;
  return { query, headers: { "X-API-KEY": creds.apiKey } };
}
