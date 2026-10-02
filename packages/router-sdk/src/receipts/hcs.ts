import type { Network } from "../types";
import type { Receipt } from "./types";

/**
 * Server-only: publish a receipt to the HCS topic. The Hiero SDK is loaded lazily so browser bundles
 * and unit tests never pull it in; tests inject a `Submitter`.
 */
export type HcsCredentials = { operatorId: string; operatorKey: string; topicId: string };

export type SubmitResult = { transactionId: string; sequenceNumber: number; topicId: string };

export type Submitter = (message: string, creds: HcsCredentials, network: Network) => Promise<SubmitResult>;

/** HCS chunks at 1024 bytes; a receipt with many quotes needs several, so allow generous headroom. */
export const MAX_CHUNKS = 20;

export const serializeReceipt = (receipt: Receipt): string => JSON.stringify(receipt);

export async function publishReceipt(
  receipt: Receipt,
  creds: HcsCredentials,
  network: Network,
  submit: Submitter = hieroSubmitter,
): Promise<SubmitResult> {
  if (!creds.operatorId || !creds.operatorKey || !creds.topicId)
    throw new Error("HCS credentials missing (HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY, NEXT_PUBLIC_RECEIPTS_TOPIC_ID)");
  return submit(serializeReceipt(receipt), creds, network);
}

/** Parse an operator key in any of the formats the Hedera tooling hands out. */
export async function parseOperatorKey(raw: string) {
  const { PrivateKey } = await import("@hiero-ledger/sdk");
  const s = raw.trim();
  if (s.startsWith("302")) return PrivateKey.fromStringDer(s); // DER-encoded (portal "DER" key)
  const hex = s.replace(/^0x/, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return PrivateKey.fromStringECDSA(hex); // EVM-style key from account:generate
  return PrivateKey.fromStringED25519(hex);
}

export const hieroSubmitter: Submitter = async (message, creds, network) => {
  const { Client, TopicMessageSubmitTransaction, TopicId } = await import("@hiero-ledger/sdk");
  const key = await parseOperatorKey(creds.operatorKey);
  const client = (network === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(creds.operatorId, key);
  try {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(creds.topicId))
      .setMessage(message)
      .setMaxChunks(MAX_CHUNKS)
      .freezeWith(client)
      .sign(key);
    const res = await tx.execute(client);
    const receipt = await res.getReceipt(client);
    return {
      transactionId: res.transactionId.toString(),
      sequenceNumber: Number(receipt.topicSequenceNumber?.toString() ?? 0),
      topicId: creds.topicId,
    };
  } finally {
    client.close();
  }
};

/** Create the receipts topic (submit key = operator) and return its ID. Used by scripts/create-topic.ts. */
export async function createReceiptsTopic(
  creds: Omit<HcsCredentials, "topicId">,
  network: Network,
  memo = "hedera-smart-order-router receipts v1",
): Promise<string> {
  const { Client, TopicCreateTransaction } = await import("@hiero-ledger/sdk");
  const key = await parseOperatorKey(creds.operatorKey);
  const client = (network === "mainnet" ? Client.forMainnet() : Client.forTestnet()).setOperator(creds.operatorId, key);
  try {
    const res = await new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(key.publicKey).execute(client);
    const receipt = await res.getReceipt(client);
    if (!receipt.topicId) throw new Error("topic creation returned no topicId");
    return receipt.topicId.toString();
  } finally {
    client.close();
  }
}
