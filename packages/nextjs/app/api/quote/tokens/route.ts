import { NextResponse } from "next/server";
import { parseNetwork } from "@sh/router-sdk/client";
import { ALLOW_MAINNET, serverConfig } from "~~/lib/router/server";

export const dynamic = "force-dynamic";

/** GET /api/quote/tokens?net=testnet → tokens the pickers can offer, plus execution flags. */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  try {
    const network = parseNetwork(q.get("net") ?? undefined);
    const cfg = serverConfig(network);
    return NextResponse.json({
      network,
      tokens: Object.values(cfg.tokens),
      executor: process.env.NEXT_PUBLIC_ROUTER_EXECUTOR ?? null,
      receiptsTopic: process.env.NEXT_PUBLIC_RECEIPTS_TOPIC_ID ?? null,
      mainnetExecution: ALLOW_MAINNET,
      v3Bot: Boolean(process.env.V3_BOT_ACCOUNT_ID && process.env.V3_BOT_PRIVATE_KEY),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
