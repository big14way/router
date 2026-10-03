/**
 * Onboard a bot account for a SaucerSwap V3 book: HTS association for both tokens, ERC-20 approval
 * to Permit2, and the reactor approval inside Permit2. Re-reads chain state after every step.
 *   yarn v3:onboard [--net testnet] [--book 3] [--dry]
 */
import { checkOnboarding, fetchDomain, runOnboarding } from "../packages/router-sdk/src";
import { argv, botContext, log, opt, raw } from "./v3-lib";

async function main() {
  const ctx = await botContext();
  const bookId = opt("--book", "3");
  const book = (await ctx.orders.books()).find(b => b.id === bookId);
  if (!book) throw new Error(`book ${bookId} not found on ${ctx.cfg.network}`);
  raw("book", { id: book.id, pair: `${book.baseTokenSymbol}/${book.quoteTokenSymbol}`, status: book.status, halted: book.isMarketHalted, amm: book.isAMMEnabled });
  const domain = await fetchDomain(ctx.cfg);
  raw("signature/domain", domain);
  const base = { cfg: ctx.cfg, publicClient: ctx.publicClient, account: ctx.evm, book, domain, auth: ctx.auth };
  const before = await checkOnboarding(base);
  raw("onboarding (chain)", before.steps.map(s => `${s.key}=${s.done}`));
  raw("onboarding (api)", before.api);
  if (before.complete || argv.includes("--dry")) {
    log(before.complete ? "already onboarded" : "dry run: not sending transactions");
    return;
  }
  if (!ctx.onboardingWallet) throw new Error("sending onboarding transactions needs an ECDSA hex key (EVM transactions)");
  const after = await runOnboarding({ ...base, walletClient: ctx.onboardingWallet, onStep: (s, h) => log(`${s.key} → ${ctx.cfg.hashscanUrl}/transaction/${h}`) });
  raw("onboarding after", after.steps.map(s => `${s.key}=${s.done}`));
  raw("onboarding (api) after", after.api);
  log(`permit2 ${after.permit2}, reactor ${after.reactor}, complete=${after.complete}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
