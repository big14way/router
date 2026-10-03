import { hashTypedData, type Address, type Hex, type TypedDataDomain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * SaucerSwap V3 order signing. Everything here was taken from the verified reactor source
 * (PartialFillLimitOrderReactor / PartialFillLimitOrderLib / PartialFillLimitOrderCanonical on
 * Sourcify) and the Orderbook API docs; the domain is always fetched from `GET /signature/domain`.
 */

/** EIP-712 domain as returned by `GET /signature/domain`. */
export type V3Domain = { name: string; version: string; chainId: number; verifyingContract: Address };

/** The EIP-712 order struct the reactor hashes (what `POST /orders/build` returns, minus metadata). */
export type V3Order = {
  info: {
    reactor: Address;
    swapper: Address;
    nonce: string;
    deadline: string;
    additionalValidationContract: Address;
    additionalValidationData: Hex;
  };
  input: { token: Address; amount: string };
  output: { token: Address; amount: string; recipient: Address };
  makerOnly: boolean;
  takerOnce: boolean;
  maxTakerFeePips: number | string;
  maxMakerFeePips: number | string;
};

export const V3_ORDER_TYPES = {
  PartialFillLimitOrder: [
    { name: "info", type: "OrderInfo" },
    { name: "input", type: "PartialFillInputToken" },
    { name: "output", type: "OutputToken" },
    { name: "makerOnly", type: "bool" },
    { name: "takerOnce", type: "bool" },
    { name: "maxTakerFeePips", type: "uint32" },
    { name: "maxMakerFeePips", type: "uint32" },
  ],
  OrderInfo: [
    { name: "reactor", type: "address" },
    { name: "swapper", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "additionalValidationContract", type: "address" },
    { name: "additionalValidationData", type: "bytes" },
  ],
  PartialFillInputToken: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  OutputToken: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
} as const;

export const SIG_MODE_EIP712 = "0x00";
export const SIG_MODE_HEDERA_PERSONAL_SIGN = "0x01";

/** Pick the EIP-712 fields out of whatever the API returned (it adds `meta`, ids, timestamps, …). */
export function extractOrder(raw: Record<string, unknown>): V3Order {
  const o = (raw.order ?? raw) as Record<string, unknown>;
  const info = (o.info ?? {}) as Record<string, unknown>;
  const input = (o.input ?? {}) as Record<string, unknown>;
  const output = (o.output ?? {}) as Record<string, unknown>;
  const req = (v: unknown, name: string): string => {
    if (v === undefined || v === null || v === "") throw new Error(`built order is missing ${name}`);
    return String(v);
  };
  return {
    info: {
      reactor: req(info.reactor, "info.reactor") as Address,
      swapper: req(info.swapper, "info.swapper") as Address,
      nonce: req(info.nonce, "info.nonce"),
      deadline: req(info.deadline, "info.deadline"),
      additionalValidationContract:
        (info.additionalValidationContract as Address) ?? "0x0000000000000000000000000000000000000000",
      additionalValidationData: ((info.additionalValidationData as Hex) ?? "0x") || "0x",
    },
    input: { token: req(input.token, "input.token") as Address, amount: req(input.amount, "input.amount") },
    output: {
      token: req(output.token, "output.token") as Address,
      amount: req(output.amount, "output.amount"),
      recipient: req(output.recipient, "output.recipient") as Address,
    },
    makerOnly: Boolean(o.makerOnly),
    takerOnce: Boolean(o.takerOnce),
    maxTakerFeePips: Number(o.maxTakerFeePips ?? 0),
    maxMakerFeePips: Number(o.maxMakerFeePips ?? 0),
  };
}

const typedMessage = (order: V3Order) => ({
  info: { ...order.info, nonce: BigInt(order.info.nonce), deadline: BigInt(order.info.deadline) },
  input: { token: order.input.token, amount: BigInt(order.input.amount) },
  output: { token: order.output.token, amount: BigInt(order.output.amount), recipient: order.output.recipient },
  makerOnly: order.makerOnly,
  takerOnce: order.takerOnce,
  maxTakerFeePips: Number(order.maxTakerFeePips),
  maxMakerFeePips: Number(order.maxMakerFeePips),
});

export const typedDataFor = (domain: V3Domain, order: V3Order) => ({
  domain: domain as TypedDataDomain,
  types: V3_ORDER_TYPES,
  primaryType: "PartialFillLimitOrder" as const,
  message: typedMessage(order),
});

/** EIP-712 digest the reactor verifies (`_hashTypedDataV4(order.hash())`). */
export const orderDigest = (domain: V3Domain, order: V3Order): Hex => hashTypedData(typedDataFor(domain, order));

/** Mode 0x00 with an ECDSA key: EIP-712 signature (65 bytes) prefixed by the mode byte. */
export async function signOrderEcdsa(privateKey: Hex, domain: V3Domain, order: V3Order): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const sig = await account.signTypedData(typedDataFor(domain, order));
  return `${SIG_MODE_EIP712}${sig.slice(2)}` as Hex;
}

/** A signer over raw bytes: for ED25519 bot keys wrap `PrivateKey.sign` from the Hiero SDK (PureEdDSA, 64 bytes). */
export type RawSigner = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

/** Mode 0x00 with an ED25519 key: sign the 32-byte EIP-712 digest itself (HAS verifies by length: 64 = ED25519). */
export async function signOrderEd25519(sign: RawSigner, domain: V3Domain, order: V3Order): Promise<Hex> {
  const sig = await sign(hexToBytes(orderDigest(domain, order)));
  if (sig.length !== 64) throw new Error(`ED25519 signature must be 64 bytes, got ${sig.length}`);
  return `${SIG_MODE_EIP712}${bytesToHex(sig)}` as Hex;
}

// ---- Mode 0x01: Hedera personal sign (HIP-820 payload, HIP-632 SignatureMap) ----

const SIGNING_FORMAT = "Saucerswap PartialFillLimitOrder HederaPersonalSign v1";
const DOMAIN_NAME = "Saucerswap PartialFillLimitOrder";

/** The wallet-facing text the reactor renders (`PartialFillLimitOrderCanonical.humanReadable`), byte for byte. */
export function canonicalOrderText(order: V3Order, verifyingContract: Address, chainId: number): string {
  const lower = (a: string) => a.toLowerCase();
  return (
    "Saucerswap PartialFillLimitOrder: confirm signed order\n" +
    `Signing Format: ${SIGNING_FORMAT}\n` +
    `Domain:         ${DOMAIN_NAME}\n` +
    `Network:        chain ${chainId}\n` +
    `Reactor:        ${lower(verifyingContract)}\n---\n` +
    `Swapper:        ${lower(order.info.swapper)}\n` +
    `Nonce:          ${BigInt(order.info.nonce)}\n` +
    `Deadline:       ${BigInt(order.info.deadline)}\n` +
    `ValidationContract: ${lower(order.info.additionalValidationContract)}\n` +
    `ValidationDataHash: ${keccakHex(order.info.additionalValidationData)}\n---\n` +
    `Input:          ${BigInt(order.input.amount)} of ${lower(order.input.token)}\n` +
    `Output:         ${BigInt(order.output.amount)} of ${lower(order.output.token)}\n` +
    `Recipient:      ${lower(order.output.recipient)}\n---\n` +
    `MakerOnly:      ${order.makerOnly ? "true" : "false"}\n` +
    `TakerOnce:      ${order.takerOnce ? "true" : "false"}\n` +
    `MaxTakerFee:    ${Number(order.maxTakerFeePips)} pips\n` +
    `MaxMakerFee:    ${Number(order.maxMakerFeePips)} pips`
  );
}

/** `"\x19Hedera Signed Message:\n" || utf8-byte-length || message` (HIP-820). */
export function hederaPersonalSignBytes(message: string | Uint8Array): Uint8Array {
  const body = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const head = new TextEncoder().encode(`\x19Hedera Signed Message:\n${body.length}`);
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

/** What a wallet (HashPack via WalletConnect `hedera_signMessage`) must sign for mode 0x01. */
export const personalSignPayload = (order: V3Order, domain: V3Domain) => {
  const text = canonicalOrderText(order, domain.verifyingContract, domain.chainId);
  return { text, bytes: hederaPersonalSignBytes(text) };
};

export type SigPair = { publicKey: Uint8Array; signature: Uint8Array; keyType: "ED25519" | "ECDSA_SECP256K1" };

/**
 * Encode a HIP-632 `SignatureMap` (protobuf) around a raw wallet/bot signature and prefix mode 0x01.
 * Wallets usually return the encoded map already; pass it as `encodedMap` to just add the prefix.
 */
export async function signatureMapMode01(pairs: SigPair[] | { encodedMap: Uint8Array }): Promise<Hex> {
  if ("encodedMap" in pairs) return `${SIG_MODE_HEDERA_PERSONAL_SIGN}${bytesToHex(pairs.encodedMap)}` as Hex;
  const { proto } = await import("@hiero-ledger/proto");
  const encoded = proto.SignatureMap.encode({
    sigPair: pairs.map(p => ({
      pubKeyPrefix: p.publicKey,
      ...(p.keyType === "ED25519" ? { ed25519: p.signature } : { ECDSASecp256k1: p.signature }),
    })),
  }).finish();
  return `${SIG_MODE_HEDERA_PERSONAL_SIGN}${bytesToHex(encoded)}` as Hex;
}

/** Sign the auth challenge: the API verifies the Hedera personal-sign form of the message (checked live on testnet). */
export async function signChallenge(message: string, sign: RawSigner): Promise<Hex> {
  return `0x${bytesToHex(await sign(hederaPersonalSignBytes(message)))}` as Hex;
}

// ---- tiny helpers (no extra deps) ----
import { keccak256, toBytes } from "viem";
const keccakHex = (data: Hex): string => keccak256(data === "0x" ? toBytes("0x") : data);
const hexToBytes = (h: Hex): Uint8Array => toBytes(h);
const bytesToHex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
