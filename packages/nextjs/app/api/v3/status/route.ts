import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v3/status?net&book&account — onboarding checklist for a V3 book.
 * Wired to the SaucerSwap V3 onboarding + auth flow in the V3 execution phase; until a bot or
 * wallet is configured it answers 200 with `configured:false` so the UI degrades gracefully.
 */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  const bot = Boolean(process.env.V3_BOT_ACCOUNT_ID && process.env.V3_BOT_PRIVATE_KEY);
  const account = q.get("account");
  return NextResponse.json({
    configured: bot,
    account: account || null,
    book: q.get("book"),
    message: bot
      ? "V3 bot account configured; onboarding and order placement run server-side."
      : account
        ? "Connect-wallet V3 signing (0x01 mode) needs the V3 execution module; configure V3_BOT_ACCOUNT_ID / V3_BOT_PRIVATE_KEY for server-side bot signing."
        : "Connect a wallet or configure a V3 bot account to place V3 orders.",
  });
}
