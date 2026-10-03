/**
 * Proof of the full V3 path with no fill risk: place a tiny resting LIMIT order far from market,
 * confirm it in GET /orders, cancel it, confirm ORDER_CANCELED. Every API response is printed raw so
 * the attempt is recorded even when the book rejects it (testnet book 3 is halted).
 *   yarn v3:place-and-cancel [--net testnet] [--book 3] [--input quote|base] [--amount 1000000] [--factor 10]
 * Mainnet requires ALLOW_MAINNET_EXECUTION=true.
 */
import type { Address } from "viem";
import { PrivateKey } from "@hiero-ledger/sdk";
import { awaitTerminal, bookStatus, orderIdOf, signOrderEcdsa, signOrderEd25519, UserEvents, type OrderSigner } from "../packages/router-sdk/src";
import { botContext, log, opt, raw } from "./v3-lib";

async function main() {
  const ctx = await botContext();
  if (ctx.cfg.network === "mainnet" && process.env.ALLOW_MAINNET_EXECUTION !== "true") throw new Error("mainnet needs ALLOW_MAINNET_EXECUTION=true");
  const bookId = opt("--book", "3");
  const book = (await ctx.orders.books()).find(b => b.id === bookId);
  if (!book) throw new Error(`book ${bookId} not found`);
  raw("book", { id: book.id, pair: `${book.baseTokenSymbol}/${book.quoteTokenSymbol}`, status: book.status, halted: book.isMarketHalted, minNotional: book.minNotional, tickStep: book.tickStep, sizeStep: book.sizeStep });
  raw("bookStatus", bookStatus(book));

  const sellQuote = opt("--input", "quote") === "quote";
  const inputToken = (sellQuote ? book.quoteTokenEvmAddress : book.baseTokenEvmAddress) as Address;
  const amount = opt("--amount", "1000000");
  const factor = BigInt(opt("--factor", "10"));
  // Far from market: ask for `factor`× the quoted output so the order rests (or is rejected) without filling.
  const quote = await ctx.orders.quoteExactInput(book.id, inputToken, amount).catch(e => ({ error: String(e) }));
  raw("quote/exact-input", quote);
  const expected = "expectedOutputAmount" in quote && BigInt(quote.expectedOutputAmount) > 0n ? BigInt(quote.expectedOutputAmount) : BigInt(amount);
  const outputAmount = (expected * factor).toString();
  const request = ctx.orders.buildLimitRequest(book, inputToken, amount, outputAmount, 3600, { recipient: ctx.evm });
  raw("build request", request);

  const sign: OrderSigner = async (order, domain) => {
    raw("built order (signing this struct)", order);
    raw("domain", domain);
    return ctx.keyType === "ECDSA_SECP256K1" && ctx.privateKeyHex ? signOrderEcdsa(ctx.privateKeyHex, domain, order) : signOrderEd25519(b => (ctx.hieroKey as PrivateKey).sign(b), domain, order);
  };
  let placed;
  try {
    placed = await ctx.orders.place(request, sign);
  } catch (e) {
    raw("place failed", { error: String(e) });
    const open = await ctx.orders.list({ orderbookId: book.id }).catch(err => ({ error: String(err) }));
    raw("GET /orders", open);
    log("attempt recorded; the API refused the order (see above)");
    return;
  }
  raw("saved order", placed.saved);
  const id = orderIdOf(placed.saved) ?? "";
  const listed = await ctx.orders.list({ orderbookId: book.id });
  raw("GET /orders", { total: listed.total, ids: listed.orders.map(orderIdOf), found: listed.orders.some(o => orderIdOf(o) === id) });

  const events = new UserEvents(ctx.cfg, ctx.auth, { books: [book.id], onEvent: e => raw("user-event", e) });
  await events.connect().catch(e => log(`user-events socket unavailable (${String(e).slice(0, 80)}); polling history instead`));
  const cancel = await ctx.orders.cancel([id]);
  raw("POST /cancel", cancel);
  const terminal = await awaitTerminal(ctx.orders, id, { events, timeoutMs: 90_000, pollMs: 5_000 });
  raw("terminal event", terminal);
  raw("GET /orders/:id/history", await ctx.orders.history(id));
  events.close();
  log(`order ${id}: placed, listed, cancelled → ${String(terminal.type ?? terminal.event ?? terminal.status)}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
