import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/v3/orders?net&account — open V3 orders. Returns `configured:false` until a bot/JWT is available. */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  const bot = Boolean(process.env.V3_BOT_ACCOUNT_ID && process.env.V3_BOT_PRIVATE_KEY);
  return NextResponse.json({
    configured: bot,
    network: q.get("net") ?? "testnet",
    account: process.env.V3_BOT_ACCOUNT_ID ?? q.get("account") ?? null,
    orders: [],
  });
}
