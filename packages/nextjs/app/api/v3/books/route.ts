import { NextResponse } from "next/server";
import { type V3Book, bookStatus, parseNetwork } from "@sh/router-sdk";
import { serverConfig } from "~~/lib/router/server";

export const dynamic = "force-dynamic";

/** GET /api/v3/books?net= — live book list with the router's tradability verdict per book. */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  try {
    const cfg = serverConfig(parseNetwork(q.get("net") ?? undefined));
    const res = await fetch(`${cfg.v3ApiUrl}/books`, { cache: "no-store" });
    const { orderbooks } = (await res.json()) as { orderbooks: V3Book[] };
    return NextResponse.json({ books: orderbooks.map(b => ({ ...b, tradable: bookStatus(b) })) });
  } catch (e) {
    return NextResponse.json({ books: [], error: (e as Error).message }, { status: 200 });
  }
}
