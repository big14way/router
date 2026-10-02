import { decodeEventLog, keccak256, parseAbi, toHex, type Hex } from "viem";
import type { NetworkConfig } from "../config";
import { fetchJson } from "../http";
import type { Receipt } from "./types";

export type Check = { label: string; ok: boolean; detail?: string };

export type Verification = {
  verified: boolean;
  topicId: string;
  sequenceNumber?: number;
  consensusTimestamp?: string;
  receipt?: Receipt;
  checks: Check[];
  links: { topic: string; message?: string; tx?: string[] };
};

type MirrorMessage = {
  consensus_timestamp: string;
  message: string;
  sequence_number: number;
  topic_id: string;
  payer_account_id: string;
  chunk_info: {
    initial_transaction_id: { transaction_valid_start?: string; account_id?: string } | string | null;
    number: number;
    total: number;
  } | null;
};

const routeExecutedAbi = parseAbi([
  "event RouteExecuted(address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 totalOut, bytes32 planHash)",
]);
export const ROUTE_EXECUTED_TOPIC0 = keccak256(toHex("RouteExecuted(address,address,address,uint256,uint256,bytes32)"));

/**
 * Read every message on the topic (paginated, chunks re-assembled) and parse the ones that are v1 receipts.
 * Returns newest first.
 */
export async function readReceipts(
  cfg: NetworkConfig,
  topicId: string,
  fetchImpl?: typeof fetch,
  limit = 100,
): Promise<{ receipt: Receipt; sequenceNumber: number; consensusTimestamp: string }[]> {
  const out: { receipt: Receipt; sequenceNumber: number; consensusTimestamp: string }[] = [];
  const pending = new Map<string, { parts: Map<number, string>; total: number; first: MirrorMessage }>();
  let url: string | undefined = `${cfg.mirrorUrl}/api/v1/topics/${topicId}/messages?limit=${limit}&order=desc`;
  let pages = 0;
  while (url && pages < 10) {
    pages += 1;
    const page: { messages: MirrorMessage[]; links?: { next?: string | null } } = await fetchJson(url, { fetchImpl });
    for (const m of page.messages) {
      const text = Buffer.from(m.message, "base64").toString("utf8");
      if (!m.chunk_info || m.chunk_info.total <= 1) {
        const r = parseReceipt(text);
        if (r) out.push({ receipt: r, sequenceNumber: m.sequence_number, consensusTimestamp: m.consensus_timestamp });
        continue;
      }
      const key = chunkKey(m);
      const entry = pending.get(key) ?? { parts: new Map(), total: m.chunk_info.total, first: m };
      entry.parts.set(m.chunk_info.number, text);
      if (m.chunk_info.number === 1) entry.first = m;
      pending.set(key, entry);
      if (entry.parts.size === entry.total) {
        const joined = Array.from({ length: entry.total }, (_, i) => entry.parts.get(i + 1) ?? "").join("");
        const r = parseReceipt(joined);
        if (r)
          out.push({
            receipt: r,
            sequenceNumber: entry.first.sequence_number,
            consensusTimestamp: entry.first.consensus_timestamp,
          });
        pending.delete(key);
      }
    }
    url = page.links?.next ? `${cfg.mirrorUrl}${page.links.next}` : undefined;
  }
  return out;
}

function chunkKey(m: MirrorMessage): string {
  const id = m.chunk_info?.initial_transaction_id;
  if (!id) return `seq-${m.sequence_number}`;
  return typeof id === "string" ? id : `${id.account_id}-${id.transaction_valid_start}`;
}

export function parseReceipt(text: string): Receipt | undefined {
  try {
    const j = JSON.parse(text);
    if (j && j.v === 1 && typeof j.planHash === "string" && typeof j.kind === "string") return j as Receipt;
  } catch {
    /* not JSON */
  }
  return undefined;
}

/**
 * Find a receipt by planHash or sequence number, then prove it against the ledger:
 * - on-chain plans: `/contracts/results/{hash}` must be SUCCESS and carry a RouteExecuted log whose planHash matches;
 * - V3 / Lambdaplex plans: each settlement transaction must exist (`/transactions/{id}`), be SUCCESS and involve the account.
 */
export async function verifyReceipt(
  cfg: NetworkConfig,
  topicId: string,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<Verification> {
  const links = { topic: `${cfg.hashscanUrl}/topic/${topicId}` };
  const checks: Check[] = [];
  const all = await readReceipts(cfg, topicId, fetchImpl);
  const isSeq = /^\d+$/.test(id);
  const hit = all.find(r =>
    isSeq ? r.sequenceNumber === Number(id) : r.receipt.planHash.toLowerCase() === id.toLowerCase(),
  );
  if (!hit) {
    checks.push({
      label: `receipt ${id} found on topic ${topicId}`,
      ok: false,
      detail: `${all.length} receipts scanned`,
    });
    return { verified: false, topicId, checks, links };
  }
  const { receipt, sequenceNumber, consensusTimestamp } = hit;
  checks.push({
    label: `receipt found on topic ${topicId}`,
    ok: true,
    detail: `sequence ${sequenceNumber} at ${consensusTimestamp}`,
  });
  const txLinks: string[] = [];

  if (receipt.kind === "ONCHAIN_SPLIT") {
    for (const hash of receipt.txHashes ?? []) {
      txLinks.push(`${cfg.hashscanUrl}/transaction/${hash}`);
      const res = await fetchJson<{
        hash?: string;
        result?: string;
        status?: string;
        logs?: { address: string; data: Hex; topics: Hex[] }[];
      }>(`${cfg.mirrorUrl}/api/v1/contracts/results/${hash}`, { fetchImpl }).catch(
        e => ({ error: String(e) }) as { error: string; result?: string; status?: string; logs?: never },
      );
      if ("error" in res && res.error) {
        checks.push({ label: `transaction ${short(hash)} exists`, ok: false, detail: res.error });
        continue;
      }
      const success = res.result === "SUCCESS" || res.status === "0x1";
      checks.push({
        label: `transaction ${short(hash)} succeeded`,
        ok: success,
        detail: `result ${res.result ?? "?"}`,
      });
      const log = (res.logs ?? []).find(l => l.topics?.[0]?.toLowerCase() === ROUTE_EXECUTED_TOPIC0.toLowerCase());
      if (!log) {
        checks.push({ label: "RouteExecuted log present", ok: false });
        continue;
      }
      try {
        const ev = decodeEventLog({ abi: routeExecutedAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        const match = ev.args.planHash.toLowerCase() === receipt.planHash.toLowerCase();
        checks.push({ label: "RouteExecuted.planHash matches receipt", ok: match, detail: ev.args.planHash });
        if (receipt.filledOut)
          checks.push({
            label: "totalOut matches receipt",
            ok: ev.args.totalOut.toString() === receipt.filledOut,
            detail: ev.args.totalOut.toString(),
          });
      } catch (e) {
        checks.push({ label: "RouteExecuted log decodes", ok: false, detail: String(e) });
      }
    }
    if (!receipt.txHashes?.length) checks.push({ label: "receipt carries a transaction hash", ok: false });
  } else {
    for (const txId of receipt.settlementTxIds ?? []) {
      txLinks.push(`${cfg.hashscanUrl}/transaction/${txId}`);
      const res = await fetchJson<{
        transactions?: { result: string; transfers?: { account: string }[]; token_transfers?: { account: string }[] }[];
      }>(`${cfg.mirrorUrl}/api/v1/transactions/${encodeURIComponent(txId)}`, { fetchImpl }).catch(() => undefined);
      const tx = res?.transactions?.[0];
      checks.push({ label: `settlement ${txId} exists`, ok: Boolean(tx) });
      if (!tx) continue;
      checks.push({ label: `settlement ${txId} succeeded`, ok: tx.result === "SUCCESS", detail: tx.result });
      if (receipt.account) {
        const involved = [...(tx.transfers ?? []), ...(tx.token_transfers ?? [])].some(
          t => t.account === receipt.account,
        );
        checks.push({ label: `settlement involves ${receipt.account}`, ok: involved });
      }
    }
    if (!receipt.settlementTxIds?.length)
      checks.push({ label: "receipt carries a settlement transaction id", ok: false });
  }

  return {
    verified: checks.every(c => c.ok),
    topicId,
    sequenceNumber,
    consensusTimestamp,
    receipt,
    checks,
    links: { ...links, message: `${cfg.hashscanUrl}/topic/${topicId}?s=${sequenceNumber}`, tx: txLinks },
  };
}

const short = (h: string) => `${h.slice(0, 10)}…`;
