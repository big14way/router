import { NextResponse } from "next/server";
import { parseNetwork } from "@sh/router-sdk";
import { botConfigured, botSession } from "~~/lib/router/v3server";

export const dynamic = "force-dynamic";

/** GET /api/v3/orders?net[&book] — the bot account's orders (wallet sessions sign in the browser; see /api/v3/status). */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  const network = parseNetwork(q.get("net") ?? undefined);
  const bot = await botSession(network).catch(() => undefined);
  if (!bot) return NextResponse.json({ configured: botConfigured(), network, account: null, orders: [], total: 0 });
  try {
    const res = await bot.orders.list({ orderbookId: q.get("book") ?? undefined, limit: 50 });
    return NextResponse.json({
      configured: true,
      network,
      account: bot.accountId,
      evm: bot.evm,
      orders: res.orders,
      total: res.total,
    });
  } catch (e) {
    return NextResponse.json({
      configured: true,
      network,
      account: bot.accountId,
      orders: [],
      total: 0,
      error: (e as Error).message,
    });
  }
}
