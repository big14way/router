import { NextResponse } from "next/server";
import { type V3Book, checkOnboarding, fetchDomain, parseNetwork } from "@sh/router-sdk";
import type { Address } from "viem";
import { serverConfig } from "~~/lib/router/server";
import { botConfigured, botSession, readClient } from "~~/lib/router/v3server";

export const dynamic = "force-dynamic";

/**
 * GET /api/v3/status?net&book&account — onboarding checklist for a wallet (or the bot when no
 * account is given), read from chain state (mirror association, ERC-20 → Permit2, Permit2 → reactor).
 * Each missing step carries the exact transaction so the UI can send it. 200 with `configured:false`
 * when nothing is set up, so the page never breaks.
 */
export async function GET(req: Request) {
  const { searchParams: q } = new URL(req.url);
  const network = parseNetwork(q.get("net") ?? undefined);
  const bookId = q.get("book") ?? "";
  const account = (q.get("account") || undefined) as Address | undefined;
  const bot = await botSession(network).catch(() => undefined);
  const subject = account ?? bot?.evm;
  if (!bookId || !subject) {
    return NextResponse.json({
      configured: botConfigured(),
      bot: bot ? { accountId: bot.accountId, evm: bot.evm } : null,
      message: subject
        ? "no book selected"
        : "Connect a wallet or configure V3_BOT_ACCOUNT_ID / V3_BOT_PRIVATE_KEY to see onboarding.",
    });
  }
  try {
    const cfg = serverConfig(network);
    const books = (await (await fetch(`${cfg.v3ApiUrl}/books`, { cache: "no-store" })).json()).orderbooks as V3Book[];
    const book = books.find(b => b.id === bookId);
    if (!book)
      return NextResponse.json({ configured: botConfigured(), error: `book ${bookId} not found` }, { status: 404 });
    const domain = await fetchDomain(cfg);
    const report = await checkOnboarding({
      cfg,
      publicClient: readClient(network),
      account: subject,
      book,
      domain,
      auth: account ? undefined : bot?.auth,
    });
    const steps = report.steps.map(s => ({
      ...s,
      tx: s.tx ? { ...s.tx, gas: s.tx.gas.toString(), value: s.tx.value?.toString() } : undefined,
    }));
    return NextResponse.json({
      configured: botConfigured(),
      bot: bot ? { accountId: bot.accountId, evm: bot.evm } : null,
      signer: account ? "wallet" : "bot",
      account: subject,
      book: {
        id: book.id,
        pair: `${book.baseTokenSymbol}/${book.quoteTokenSymbol}`,
        status: book.status,
        halted: book.isMarketHalted === 1,
      },
      domain,
      permit2: report.permit2,
      steps,
      complete: report.complete,
      api: report.api,
      message: report.complete
        ? "Onboarded: the account can place orders on this book."
        : `${steps.filter(s => !s.done).length} onboarding step(s) missing.`,
    });
  } catch (e) {
    return NextResponse.json({
      configured: botConfigured(),
      error: (e as Error).message,
      message: `onboarding check failed: ${(e as Error).message}`,
    });
  }
}
