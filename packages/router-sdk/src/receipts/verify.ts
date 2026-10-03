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
    const accountId = receipt.account ? await resolveAccountId(cfg, receipt.account, fetchImpl) : undefined;
    for (const txId of receipt.settlementTxIds ?? []) {
      txLinks.push(`${cfg.hashscanUrl}/transaction/${txId}`);
      if (EVM_HASH.test(txId)) {
        // EVM settlement hash: the contract result must succeed and its logs must touch the trader.
        const res = await fetchJson<{ result?: string; from?: string; logs?: { topics?: string[]; data?: string }[] }>(
          `${cfg.mirrorUrl}/api/v1/contracts/results/${txId}`,
          { fetchImpl },
        ).catch(() => undefined);
        checks.push({ label: `settlement ${short(txId)} exists`, ok: Boolean(res?.result) });
        if (!res?.result) continue;
        checks.push({ label: `settlement ${short(txId)} succeeded`, ok: res.result === "SUCCESS", detail: res.result });
        if (receipt.account?.startsWith("0x")) {
          const needle = receipt.account.toLowerCase().replace(/^0x/, "");
          const involved =
            res.from?.toLowerCase().endsWith(needle) ||
            (res.logs ?? []).some(l => (l.topics ?? []).some(t => t.toLowerCase().endsWith(needle)));
          checks.push({ label: `settlement moves funds of ${short(receipt.account)}`, ok: Boolean(involved) });
        }
        continue;
      }
      // A Hedera transaction id returns the parent and its child records (same id, nonce 1..n); token
      // movements of a contract settlement live on the children, so scan all of them.
      type MirrorTx = {
        nonce?: number;
        result: string;
        transfers?: { account: string; amount?: number }[];
        token_transfers?: { account: string; token_id?: string; amount?: number }[];
      };
      const res = await fetchJson<{ transactions?: MirrorTx[] }>(
        `${cfg.mirrorUrl}/api/v1/transactions/${encodeURIComponent(mirrorTxId(txId))}`,
        { fetchImpl },
      ).catch(() => undefined);
      const all = res?.transactions ?? [];
      const parent = all.find(t => (t.nonce ?? 0) === 0) ?? all[0];
      checks.push({ label: `settlement ${txId} exists`, ok: Boolean(parent) });
      if (!parent) continue;
      checks.push({ label: `settlement ${txId} succeeded`, ok: parent.result === "SUCCESS", detail: parent.result });
      if (accountId) {
        const moves = all.flatMap(t => [...(t.transfers ?? []), ...(t.token_transfers ?? [])]);
        checks.push({ label: `settlement involves ${accountId}`, ok: moves.some(m => m.account === accountId) });
        if (receipt.filledOut && receipt.tokenOut !== "0.0.0") {
          const received = all
            .flatMap(t => t.token_transfers ?? [])
            .filter(m => m.account === accountId && m.token_id === receipt.tokenOut && (m.amount ?? 0) > 0)
            .reduce((sum, m) => sum + BigInt(m.amount ?? 0), 0n);
          checks.push({
            label: `${accountId} received ${receipt.filledOut} of ${receipt.tokenOut}`,
            ok: received === BigInt(receipt.filledOut),
            detail: received.toString(),
          });
        }
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

const EVM_HASH = /^0x[0-9a-fA-F]{64}$/;

/** `0.0.6628041@1791023253.931205520` (SDK / API form) → `0.0.6628041-1791023253-931205520` (mirror form). */
export const mirrorTxId = (id: string): string => {
  const m = /^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : id;
};

/** Receipts record the trader as an EVM address or an account id; transfers on the mirror use account ids. */
async function resolveAccountId(
  cfg: NetworkConfig,
  account: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  if (/^\d+\.\d+\.\d+$/.test(account)) return account;
  const r = await fetchJson<{ account?: string }>(`${cfg.mirrorUrl}/api/v1/accounts/${account}`, { fetchImpl }).catch(
    () => undefined,
  );
  return r?.account;
}
