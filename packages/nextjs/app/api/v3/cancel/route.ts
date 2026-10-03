import { NextResponse } from "next/server";
import { awaitTerminal, parseNetwork } from "@sh/router-sdk";
import { botSession } from "~~/lib/router/v3server";

export const dynamic = "force-dynamic";

/** POST /api/v3/cancel { net, orderIds } — bot cancel; waits (briefly) for ORDER_CANCELED through history. */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const network = parseNetwork(body.net);
    const bot = await botSession(network);
    if (!bot) return NextResponse.json({ error: "no V3 bot configured" }, { status: 503 });
    const ids: (string | number)[] = body.orderIds ?? [];
    const accepted = await bot.orders.cancel(ids);
    const confirmations = await Promise.all(
      ids.map(id =>
        awaitTerminal(bot.orders, id, { timeoutMs: 20_000, pollMs: 4_000 })
          .then(e => ({ id, event: e }))
          .catch(e => ({ id, error: (e as Error).message })),
      ),
    );
    return NextResponse.json({ accepted, confirmations });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
