import { NextResponse } from "next/server";
import { jsonSafe, quoteAndPlan } from "~~/lib/router/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/quote?net=testnet&in=HBAR&out=USDC&amount=10[&slippage=50][&split=0]
 * Quotes every venue and returns the plan the app would execute. No wallet, no env needed.
 */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  try {
    const res = await quoteAndPlan({
      net: q.get("net") ?? undefined,
      in: q.get("in") ?? undefined,
      out: q.get("out") ?? undefined,
      amount: q.get("amount") ?? undefined,
      slippageBps: q.get("slippage") ? Number(q.get("slippage")) : undefined,
      split: q.get("split") !== "0",
    });
    return new NextResponse(JSON.stringify(res, jsonSafe), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
