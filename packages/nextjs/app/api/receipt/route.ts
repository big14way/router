import { NextResponse } from "next/server";
import { type ExecutionPlan, publishReceipt, receiptFromPlan, verifyReceipt } from "@sh/router-sdk";
import { jsonSafe, serverConfig } from "~~/lib/router/server";

export const dynamic = "force-dynamic";

const creds = () => ({
  operatorId: process.env.HEDERA_OPERATOR_ID ?? "",
  operatorKey: process.env.HEDERA_OPERATOR_KEY ?? "",
  topicId: process.env.NEXT_PUBLIC_RECEIPTS_TOPIC_ID ?? "",
});

/** Revive a plan that travelled through JSON (bigints are decimal strings). */
function revivePlan(raw: ExecutionPlan): ExecutionPlan {
  const big = (v: unknown) => BigInt(v as string);
  const quote = (q: ExecutionPlan["bestSingleVenue"]) => ({
    ...q,
    amountIn: big(q.amountIn),
    amountOut: big(q.amountOut),
    feeOut: q.feeOut === undefined ? undefined : big(q.feeOut),
    gasEstimate: q.gasEstimate === undefined ? undefined : big(q.gasEstimate),
    snappedInputAmount: q.snappedInputAmount === undefined ? undefined : big(q.snappedInputAmount),
  });
  return {
    ...raw,
    amountIn: big(raw.amountIn),
    totalOut: big(raw.totalOut),
    totalMinOut: big(raw.totalMinOut),
    legs: raw.legs?.map(l => ({ ...l, amountIn: big(l.amountIn), amountOut: big(l.amountOut), minOut: big(l.minOut) })),
    order: raw.order ? quote(raw.order) : undefined,
    bestSingleVenue: quote(raw.bestSingleVenue),
    alternatives: raw.alternatives.map(quote),
  };
}

/**
 * POST /api/receipt { plan, txHashes?, settlementTxIds?, filledIn?, filledOut?, account? }
 * Publishes a v1 best-execution receipt to the HCS topic with the server-only operator key.
 */
export async function POST(req: Request) {
  const c = creds();
  if (!c.operatorId || !c.operatorKey || !c.topicId) {
    return NextResponse.json(
      { error: "receipts not configured: set NEXT_PUBLIC_RECEIPTS_TOPIC_ID, HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY" },
      { status: 503 },
    );
  }
  try {
    const body = await req.json();
    const plan = revivePlan(body.plan);
    if (plan.network === "mainnet" && process.env.ALLOW_MAINNET_EXECUTION !== "true") {
      return NextResponse.json({ error: "mainnet receipts need ALLOW_MAINNET_EXECUTION=true" }, { status: 403 });
    }
    const receipt = receiptFromPlan(plan, {
      txHashes: body.txHashes,
      settlementTxIds: body.settlementTxIds,
      filledIn: body.filledIn,
      filledOut: body.filledOut,
      account: body.account,
    });
    const res = await publishReceipt(receipt, c, plan.network);
    return new NextResponse(
      JSON.stringify({ id: String(res.sequenceNumber), ...res, planHash: receipt.planHash }, jsonSafe),
      { headers: { "content-type": "application/json" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** GET /api/receipt?id=<planHash|sequenceNumber>[&net=testnet] — verify a receipt from the mirror node. */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  const id = q.get("id") ?? "";
  const topic = process.env.NEXT_PUBLIC_RECEIPTS_TOPIC_ID;
  if (!topic)
    return NextResponse.json({
      id,
      topic: null,
      configured: false,
      verified: false,
      message: "no receipts topic configured (NEXT_PUBLIC_RECEIPTS_TOPIC_ID)",
    });
  try {
    const net = q.get("net") === "mainnet" ? "mainnet" : "testnet";
    const v = await verifyReceipt(serverConfig(net), topic, id);
    return NextResponse.json({ id, topic, configured: true, ...v });
  } catch (e) {
    return NextResponse.json({ id, topic, configured: true, verified: false, message: (e as Error).message });
  }
}
