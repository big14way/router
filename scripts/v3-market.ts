/**
 * Execute a SaucerSwap V3 market order through the SDK executor (execute/v3.ts) with the bot account:
 * on-chain onboarding check → fresh quote → build → sign (0x00) → save → user-events/history until FILLED →
 * settlement transaction(s). Prints raw API objects so the run is auditable.
 *   yarn v3:market [--net testnet] [--book 3] [--side SELL|BUY] [--amount 10000000] [--receipt]
 * `--receipt` publishes an HCS receipt for the fill (needs HEDERA_OPERATOR_* and NEXT_PUBLIC_RECEIPTS_TOPIC_ID).
 * Mainnet requires ALLOW_MAINNET_EXECUTION=true and is capped by MAINNET_MAX_NOTIONAL_USD.
 */
import {
  executeV3,
  offchainPlanHash,
  publishReceipt,
  receiptFromPlan,
  SaucerV3,
  signOrderEcdsa,
  signOrderEd25519,
  UserEvents,
  type ExecutionPlan,
  type Token,
} from "../packages/router-sdk/src";
import { argv, botContext, log, opt, raw } from "./v3-lib";

async function main() {
  const ctx = await botContext();
  const bookId = opt("--book", "3");
  const side = opt("--side", "SELL") as "SELL" | "BUY";
  const amount = BigInt(opt("--amount", "10000000"));
  const book = (await ctx.orders.books()).find(b => b.id === bookId);
  if (!book) throw new Error(`book ${bookId} not found`);
  const asToken = (id: string, evm: string, symbol: string | null, decimals: number | null): Token => ({ id, evm: evm as `0x${string}`, symbol: symbol ?? id, name: symbol ?? id, decimals: decimals ?? 0, native: id === "0.0.0" });
  const base = asToken(book.baseTokenId, book.baseTokenEvmAddress, book.baseTokenSymbol, book.baseTokenDecimals);
  const quote = asToken(book.quoteTokenId, book.quoteTokenEvmAddress, book.quoteTokenSymbol, book.quoteTokenDecimals);
  const [tokenIn, tokenOut] = side === "SELL" ? [base, quote] : [quote, base];

  const [q] = await new SaucerV3(ctx.cfg).quoteExactInput(tokenIn, tokenOut, amount);
  if (!q) throw new Error(`book ${bookId} gave no executable quote (status ${book.status}, halted ${book.isMarketHalted})`);
  raw("router quote (V3 adapter)", { bookId: q.bookId, side: q.side, amountIn: q.amountIn.toString(), amountOut: q.amountOut.toString(), feeOut: q.feeOut?.toString(), fillable: q.fillable, detail: q.detail });
  const slippageBps = Number(opt("--slippage", "500"));
  const totalMinOut = q.amountOut - (q.amountOut * BigInt(slippageBps)) / 10_000n;
  const createdAt = Date.now();
  const plan: ExecutionPlan = {
    kind: "V3_MARKET",
    network: ctx.cfg.network,
    tokenIn,
    tokenOut,
    amountIn: q.amountIn,
    totalOut: q.amountOut,
    totalMinOut,
    slippageBps,
    order: q,
    bestSingleVenue: q,
    alternatives: [q],
    planHash: offchainPlanHash({ kind: "V3_MARKET", network: ctx.cfg.network, tokenIn: tokenIn.id, tokenOut: tokenOut.id, amountIn: q.amountIn, totalMinOut, route: q.bookId, side: q.side, createdAt }),
    createdAt,
  };
  log(`plan V3_MARKET ${plan.amountIn} ${tokenIn.symbol} → ≥ ${plan.totalMinOut} ${tokenOut.symbol} on book ${bookId}, planHash ${plan.planHash}`);

  const events = new UserEvents(ctx.cfg, ctx.auth, { books: [bookId], onEvent: e => raw("user-event", e) });
  await events.connect().catch(e => log(`user-events unavailable (${String(e).slice(0, 80)}); polling history`));
  const sign = (order: Parameters<typeof signOrderEcdsa>[2], domain: Parameters<typeof signOrderEcdsa>[1]) =>
    ctx.keyType === "ECDSA_SECP256K1" && ctx.privateKeyHex ? signOrderEcdsa(ctx.privateKeyHex, domain, order) : signOrderEd25519(b => ctx.hieroKey.sign(b), domain, order);
  try {
    const result = await executeV3(plan, {
      cfg: ctx.cfg,
      auth: ctx.auth,
      orders: ctx.orders,
      publicClient: ctx.publicClient,
      account: ctx.evm,
      sign,
      events,
      timeoutMs: 120_000,
      notionalUsd: Number(process.env.V3_NOTIONAL_USD ?? "0") || undefined,
      onStep: (s, d) => log(`${s} ${d ?? ""}`),
    });
    raw("result", { ...result, filledIn: result.filledIn.toString(), filledOut: result.filledOut.toString() });
    raw("GET /orders/:id/history", await ctx.orders.history(result.refs!.orderId!));
    for (const h of result.txHashes) log(`settlement ${ctx.cfg.hashscanUrl}/transaction/${h}`);
    if (argv.includes("--receipt")) {
      const creds = { operatorId: process.env.HEDERA_OPERATOR_ID ?? "", operatorKey: process.env.HEDERA_OPERATOR_KEY ?? "", topicId: process.env.NEXT_PUBLIC_RECEIPTS_TOPIC_ID ?? "" };
      const pub = await publishReceipt(receiptFromPlan(plan, { settlementTxIds: result.txHashes, filledIn: result.filledIn, filledOut: result.filledOut, account: ctx.evm }), creds, ctx.cfg.network);
      log(`receipt published: topic ${pub.topicId} sequence ${pub.sequenceNumber}`);
    }
  } finally {
    events.close();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
