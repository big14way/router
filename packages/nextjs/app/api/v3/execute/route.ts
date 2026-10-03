import { NextResponse } from "next/server";
import { type ExecutionPlan, OnboardingRequired, executeV3, publishReceipt, receiptFromPlan } from "@sh/router-sdk";
import { jsonSafe, serverConfig } from "~~/lib/router/server";
import { botSession, readClient } from "~~/lib/router/v3server";

export const dynamic = "force-dynamic";

/**
 * POST /api/v3/execute { plan, notionalUsd? } — execute a V3_MARKET plan with the server-side bot
 * (0x00 signing). Onboarding is verified on chain first; mainnet needs ALLOW_MAINNET_EXECUTION and
 * the notional cap. Publishes the HCS receipt when the topic is configured.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const plan = revive(body.plan as ExecutionPlan);
    const bot = await botSession(plan.network);
    if (!bot)
      return NextResponse.json(
        { error: "no V3 bot configured (V3_BOT_ACCOUNT_ID / V3_BOT_PRIVATE_KEY)" },
        { status: 503 },
      );
    const cfg = serverConfig(plan.network);
    const steps: string[] = [];
    const result = await executeV3(plan, {
      cfg,
      auth: bot.auth,
      orders: bot.orders,
      publicClient: readClient(plan.network),
      account: bot.evm,
      sign: bot.sign,
      timeoutMs: 120_000,
      notionalUsd: body.notionalUsd,
      onStep: (s, d) => steps.push(`${s} ${d ?? ""}`.trim()),
    });
    let receipt: unknown;
    const creds = {
      operatorId: process.env.HEDERA_OPERATOR_ID ?? "",
      operatorKey: process.env.HEDERA_OPERATOR_KEY ?? "",
      topicId: process.env.NEXT_PUBLIC_RECEIPTS_TOPIC_ID ?? "",
    };
    if (creds.operatorId && creds.operatorKey && creds.topicId) {
      receipt = await publishReceipt(
        receiptFromPlan(plan, {
          settlementTxIds: result.txHashes,
          filledIn: result.filledIn,
          filledOut: result.filledOut,
          account: bot.accountId,
        }),
        creds,
        plan.network,
      ).catch(e => ({ error: (e as Error).message }));
    }
    return new NextResponse(JSON.stringify({ result, steps, receipt }, jsonSafe), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    if (e instanceof OnboardingRequired)
      return NextResponse.json({ error: e.message, onboarding: e.report }, { status: 409 });
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

function revive(raw: ExecutionPlan): ExecutionPlan {
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
    order: raw.order ? quote(raw.order) : undefined,
    bestSingleVenue: quote(raw.bestSingleVenue),
    alternatives: raw.alternatives.map(quote),
    legs: raw.legs?.map(l => ({ ...l, amountIn: big(l.amountIn), amountOut: big(l.amountOut), minOut: big(l.minOut) })),
  };
}
