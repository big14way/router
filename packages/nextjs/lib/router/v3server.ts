import { serverConfig } from "./server";
import { PrivateKey } from "@hiero-ledger/sdk";
import {
  type Network,
  type OrderSigner,
  V3Auth,
  V3Orders,
  signOrderEcdsa,
  signOrderEd25519,
  signerFromHieroKey,
} from "@sh/router-sdk";
import "server-only";
import { type Address, createPublicClient, http } from "viem";
import { hedera, hederaTestnet } from "viem/chains";

/**
 * Server-side V3 bot session. Built only when V3_BOT_ACCOUNT_ID / V3_BOT_PRIVATE_KEY are set; the
 * key never leaves this module. Sessions are cached per network for the process lifetime.
 */
export type BotSession = {
  accountId: string;
  evm: Address;
  auth: V3Auth;
  orders: V3Orders;
  sign: OrderSigner;
  keyType: "ECDSA_SECP256K1" | "ED25519";
};

const sessions = new Map<Network, BotSession>();

export function botConfigured(): boolean {
  return Boolean(process.env.V3_BOT_ACCOUNT_ID && process.env.V3_BOT_PRIVATE_KEY);
}

export async function botSession(network: Network): Promise<BotSession | undefined> {
  if (!botConfigured()) return undefined;
  const hit = sessions.get(network);
  if (hit) return hit;
  const cfg = serverConfig(network);
  const raw = process.env.V3_BOT_PRIVATE_KEY!.trim();
  const hex = raw.replace(/^0x/, "");
  const key = hex.startsWith("302")
    ? PrivateKey.fromStringDer(hex)
    : process.env.V3_BOT_KEY_TYPE === "ED25519"
      ? PrivateKey.fromStringED25519(hex)
      : PrivateKey.fromStringECDSA(hex);
  const keyType: BotSession["keyType"] = key.type === "ED25519" ? "ED25519" : "ECDSA_SECP256K1";
  const accountId = process.env.V3_BOT_ACCOUNT_ID!;
  const acct = await fetch(`${cfg.mirrorUrl}/api/v1/accounts/${accountId}`).then(r => r.json());
  const evm = acct.evm_address as Address;
  const auth = new V3Auth(cfg, signerFromHieroKey(accountId, key));
  const orders = new V3Orders(cfg, auth);
  const sign: OrderSigner = (order, domain) =>
    keyType === "ECDSA_SECP256K1" && !hex.startsWith("302")
      ? signOrderEcdsa(`0x${hex}`, domain, order)
      : signOrderEd25519(b => key.sign(b), domain, order);
  const session: BotSession = { accountId, evm, auth, orders, sign, keyType };
  sessions.set(network, session);
  return session;
}

export function readClient(network: Network) {
  const cfg = serverConfig(network);
  return createPublicClient({ chain: network === "mainnet" ? hedera : hederaTestnet, transport: http(cfg.rpcUrl) });
}
