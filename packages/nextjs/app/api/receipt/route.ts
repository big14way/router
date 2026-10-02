import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const configured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_RECEIPTS_TOPIC_ID && process.env.HEDERA_OPERATOR_ID && process.env.HEDERA_OPERATOR_KEY,
  );

/** POST /api/receipt — publish a best-execution receipt to HCS (server-only operator key). */
export async function POST() {
  if (!configured())
    return NextResponse.json(
      { error: "receipts not configured: set NEXT_PUBLIC_RECEIPTS_TOPIC_ID, HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY" },
      { status: 503 },
    );
  return NextResponse.json({ error: "receipt publishing is wired in the HCS receipts phase" }, { status: 501 });
}

/** GET /api/receipt?id=<planHash|sequence> — verify a receipt against the mirror node. */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  const topic = process.env.NEXT_PUBLIC_RECEIPTS_TOPIC_ID ?? null;
  return NextResponse.json({
    id: q.get("id"),
    topic,
    configured: Boolean(topic),
    verified: false,
    message: topic
      ? "verification is wired in the HCS receipts phase"
      : "no receipts topic configured (NEXT_PUBLIC_RECEIPTS_TOPIC_ID)",
  });
}
