import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256 } from "viem";
import { getConfig } from "../config";
import type { ExecutionPlan, Quote } from "../types";
import { fakeFetch } from "../venues/testkit";
import { MAX_CHUNKS, publishReceipt, serializeReceipt, type Submitter } from "./hcs";
import { receiptFromPlan } from "./types";
import { parseReceipt, readReceipts, ROUTE_EXECUTED_TOPIC0, verifyReceipt } from "./verify";

const cfg = getConfig("testnet");
const WHBAR = cfg.tokens.WHBAR!;
const SAUCE = cfg.tokens.SAUCE!;
const v1: Quote = {
  venue: "SAUCER_V1",
  path: [WHBAR.evm, SAUCE.evm],
  amountIn: 100n,
  amountOut: 50n,
  fillable: true,
  minNotionalOk: true,
  fetchedAt: 0,
};
const v2: Quote = {
  venue: "SAUCER_V2",
  path: "0xabc",
  fees: [3000],
  amountIn: 100n,
  amountOut: 40n,
  fillable: true,
  minNotionalOk: true,
  fetchedAt: 0,
};
const planHash = `0x${"ab".repeat(32)}` as const;
const plan: ExecutionPlan = {
  kind: "ONCHAIN_SPLIT",
  network: "testnet",
  tokenIn: WHBAR,
  tokenOut: SAUCE,
  amountIn: 100n,
  totalOut: 90n,
  totalMinOut: 89n,
  slippageBps: 50,
  legs: [
    { venue: 0, path: [WHBAR.evm, SAUCE.evm], amountIn: 60n, amountOut: 50n, minOut: 49n },
    { venue: 1, path: "0xabc", amountIn: 40n, amountOut: 40n, minOut: 39n },
  ],
  bestSingleVenue: v1,
  alternatives: [v1, v2],
  planHash,
  createdAt: 1,
};
const b64 = (s: string) => Buffer.from(s).toString("base64");
const TX = "0x" + "11".repeat(32);

describe("receiptFromPlan / publish", () => {
  it("builds a v1 receipt with quotes, legs and fills", () => {
    const r = receiptFromPlan(plan, { txHashes: [TX], filledIn: 100n, filledOut: 90n, account: "0xuser" }, 123);
    expect(r).toMatchObject({
      v: 1,
      planHash,
      net: "testnet",
      kind: "ONCHAIN_SPLIT",
      tokenIn: WHBAR.id,
      tokenOut: SAUCE.id,
      amountIn: "100",
      selected: "SPLIT",
      filledOut: "90",
      ts: 123,
    });
    expect(r.quotes).toEqual([
      { venue: "SAUCER_V1", amountOut: "50", fillable: true, route: `${WHBAR.evm}>${SAUCE.evm}` },
      { venue: "SAUCER_V2", amountOut: "40", fillable: true, route: "0xabc" },
    ]);
    expect(r.legs![1]).toEqual({ venue: 1, path: "0xabc", amountIn: "40", minOut: "39" });
    const single = receiptFromPlan({ ...plan, legs: [plan.legs![1]!] }, {});
    expect(single.selected).toBe("SAUCER_V2");
    const v3: Quote = {
      venue: "SAUCER_V3",
      bookId: "2",
      side: "SELL",
      amountIn: 100n,
      amountOut: 95n,
      fillable: true,
      minNotionalOk: true,
      fetchedAt: 0,
    };
    const off = receiptFromPlan(
      { ...plan, kind: "V3_MARKET", legs: undefined, order: v3, alternatives: [v3] },
      { settlementTxIds: ["0.0.5-1-2"] },
    );
    expect(off.selected).toBe("SAUCER_V3");
    expect(off.order).toMatchObject({ bookId: "2", side: "SELL", amountOut: "95" });
    expect(off.quotes[0]!.route).toBe("book 2 SELL");
    expect(parseReceipt(serializeReceipt(off))).toEqual(off);
  });

  it("publishes through an injected submitter and rejects missing credentials", async () => {
    const seen: string[] = [];
    const submit: Submitter = async (msg, creds, net) => {
      seen.push(msg, creds.topicId, net);
      return { transactionId: "0.0.1-1-1", sequenceNumber: 7, topicId: creds.topicId };
    };
    const r = receiptFromPlan(plan, {});
    const res = await publishReceipt(r, { operatorId: "0.0.1", operatorKey: "k", topicId: "0.0.9" }, "testnet", submit);
    expect(res.sequenceNumber).toBe(7);
    expect(seen).toEqual([serializeReceipt(r), "0.0.9", "testnet"]);
    await expect(
      publishReceipt(r, { operatorId: "", operatorKey: "k", topicId: "0.0.9" }, "testnet", submit),
    ).rejects.toThrow(/credentials missing/);
    expect(MAX_CHUNKS).toBeGreaterThan(1);
  });
});

describe("readReceipts", () => {
  it("re-assembles chunked messages, paginates and skips non-receipts", async () => {
    const r = receiptFromPlan(plan, { txHashes: [TX] }, 5);
    const text = serializeReceipt(r);
    const [a, b] = [text.slice(0, 50), text.slice(50)];
    const init = { account_id: "0.0.1", transaction_valid_start: "1.0" };
    const page1 = {
      body: {
        messages: [
          {
            consensus_timestamp: "3.0",
            message: b64("hello"),
            sequence_number: 3,
            topic_id: "0.0.9",
            payer_account_id: "0.0.1",
            chunk_info: null,
          },
        ],
        links: { next: "/api/v1/topics/0.0.9/messages?limit=100&order=desc&timestamp=lt:3.0" },
      },
    };
    const page2 = {
      body: {
        messages: [
          {
            consensus_timestamp: "2.1",
            message: b64(b),
            sequence_number: 2,
            topic_id: "0.0.9",
            payer_account_id: "0.0.1",
            chunk_info: { initial_transaction_id: init, number: 2, total: 2 },
          },
          {
            consensus_timestamp: "2.0",
            message: b64(a),
            sequence_number: 1,
            topic_id: "0.0.9",
            payer_account_id: "0.0.1",
            chunk_info: { initial_transaction_id: init, number: 1, total: 2 },
          },
        ],
        links: { next: null },
      },
    };
    const fetchImpl = fakeFetch({
      "/topics/0.0.9/messages": url => (url.includes("timestamp=lt:3.0") ? page2 : page1),
    });
    const list = await readReceipts(cfg, "0.0.9", fetchImpl);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ sequenceNumber: 1, consensusTimestamp: "2.0" });
    expect(list[0]!.receipt).toEqual(r);
  });
});

describe("verifyReceipt", () => {
  const r = receiptFromPlan(plan, { txHashes: [TX], filledOut: 90n }, 5);
  const topicPage = {
    body: {
      messages: [
        {
          consensus_timestamp: "2.0",
          message: b64(serializeReceipt(r)),
          sequence_number: 4,
          topic_id: "0.0.9",
          payer_account_id: "0.0.1",
          chunk_info: null,
        },
      ],
      links: { next: null },
    },
  };
  const logFor = (hash: string, totalOut: bigint) => ({
    address: "0xexec",
    topics: [
      ROUTE_EXECUTED_TOPIC0,
      `0x${"00".repeat(12)}${"aa".repeat(20)}`,
      `0x${"00".repeat(12)}${WHBAR.evm.slice(2)}`,
      `0x${"00".repeat(12)}${SAUCE.evm.slice(2)}`,
    ],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
      [100n, totalOut, hash as `0x${string}`],
    ),
  });

  it("verifies an on-chain receipt against the RouteExecuted log", async () => {
    const fetchImpl = fakeFetch({
      "/topics/0.0.9/messages": topicPage,
      [`/contracts/results/${TX}`]: {
        body: { hash: TX, result: "SUCCESS", status: "0x1", logs: [logFor(planHash, 90n)] },
      },
    });
    const v = await verifyReceipt(cfg, "0.0.9", planHash, fetchImpl);
    expect(v.verified).toBe(true);
    expect(v.sequenceNumber).toBe(4);
    expect(v.checks.map(c => c.label)).toEqual([
      "receipt found on topic 0.0.9",
      `transaction ${TX.slice(0, 10)}… succeeded`,
      "RouteExecuted.planHash matches receipt",
      "totalOut matches receipt",
    ]);
    expect(v.links.tx).toEqual([`${cfg.hashscanUrl}/transaction/${TX}`]);
    const bySeq = await verifyReceipt(cfg, "0.0.9", "4", fetchImpl);
    expect(bySeq.verified).toBe(true);
  });

  it("fails when the log hash differs, the tx failed, the log is missing, or the receipt is absent", async () => {
    const other = keccak256("0x01");
    const wrong = fakeFetch({
      "/topics/0.0.9/messages": topicPage,
      "/contracts/results/": { body: { result: "SUCCESS", logs: [logFor(other, 90n)] } },
    });
    expect((await verifyReceipt(cfg, "0.0.9", planHash, wrong)).verified).toBe(false);
    const failed = fakeFetch({
      "/topics/0.0.9/messages": topicPage,
      "/contracts/results/": { body: { result: "CONTRACT_REVERT_EXECUTED", logs: [] } },
    });
    const f = await verifyReceipt(cfg, "0.0.9", planHash, failed);
    expect(f.verified).toBe(false);
    expect(f.checks.find(c => c.label === "RouteExecuted log present")?.ok).toBe(false);
    const missingTx = fakeFetch({ "/topics/0.0.9/messages": topicPage });
    expect((await verifyReceipt(cfg, "0.0.9", planHash, missingTx)).checks[1]).toMatchObject({ ok: false });
    const none = await verifyReceipt(
      cfg,
      "0.0.9",
      "0xdead",
      fakeFetch({ "/topics/0.0.9/messages": { body: { messages: [] } } }),
    );
    expect(none.verified).toBe(false);
    expect(none.checks[0]!.detail).toBe("0 receipts scanned");
    const noHash = receiptFromPlan(plan, {}, 5);
    const nh = fakeFetch({
      "/topics/0.0.9/messages": {
        body: {
          messages: [
            {
              consensus_timestamp: "2.0",
              message: b64(serializeReceipt(noHash)),
              sequence_number: 1,
              topic_id: "0.0.9",
              payer_account_id: "0.0.1",
              chunk_info: null,
            },
          ],
        },
      },
    });
    expect((await verifyReceipt(cfg, "0.0.9", planHash, nh)).checks.at(-1)).toMatchObject({
      label: "receipt carries a transaction hash",
      ok: false,
    });
  });

  it("verifies off-chain receipts through /transactions", async () => {
    const v3: Quote = {
      venue: "SAUCER_V3",
      bookId: "2",
      side: "SELL",
      amountIn: 100n,
      amountOut: 95n,
      fillable: true,
      minNotionalOk: true,
      fetchedAt: 0,
    };
    const off = receiptFromPlan(
      { ...plan, kind: "V3_MARKET", legs: undefined, order: v3, alternatives: [v3] },
      { settlementTxIds: ["0.0.5-1-2"], account: "0.0.5" },
      9,
    );
    const page = {
      body: {
        messages: [
          {
            consensus_timestamp: "2.0",
            message: b64(serializeReceipt(off)),
            sequence_number: 1,
            topic_id: "0.0.9",
            payer_account_id: "0.0.1",
            chunk_info: null,
          },
        ],
      },
    };
    const ok = fakeFetch({
      "/topics/0.0.9/messages": page,
      "/transactions/0.0.5-1-2": {
        body: { transactions: [{ result: "SUCCESS", transfers: [{ account: "0.0.5" }], token_transfers: [] }] },
      },
    });
    const v = await verifyReceipt(cfg, "0.0.9", off.planHash, ok);
    expect(v.verified).toBe(true);
    expect(v.checks.map(c => c.ok)).toEqual([true, true, true, true]);
    const notInvolved = fakeFetch({
      "/topics/0.0.9/messages": page,
      "/transactions/0.0.5-1-2": { body: { transactions: [{ result: "SUCCESS", transfers: [{ account: "0.0.6" }] }] } },
    });
    expect((await verifyReceipt(cfg, "0.0.9", off.planHash, notInvolved)).verified).toBe(false);
    const gone = fakeFetch({ "/topics/0.0.9/messages": page });
    expect((await verifyReceipt(cfg, "0.0.9", off.planHash, gone)).checks[1]).toMatchObject({ ok: false });
    const noIds = receiptFromPlan(
      { ...plan, kind: "V3_MARKET", legs: undefined, order: v3, alternatives: [v3] },
      {},
      9,
    );
    const ni = fakeFetch({
      "/topics/0.0.9/messages": {
        body: {
          messages: [
            {
              consensus_timestamp: "2.0",
              message: b64(serializeReceipt(noIds)),
              sequence_number: 1,
              topic_id: "0.0.9",
              payer_account_id: "0.0.1",
              chunk_info: null,
            },
          ],
        },
      },
    });
    expect((await verifyReceipt(cfg, "0.0.9", noIds.planHash, ni)).checks.at(-1)!.ok).toBe(false);
  });
});
