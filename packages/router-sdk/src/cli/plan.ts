import { loadEnv } from "./env";
import { configFromEnv, parseNetwork } from "../config";
import { buildPlan, NoRouteError, routeKey, type Requote } from "../router";
import { resolveToken } from "../tokens";
import { formatUnits, parseUnits } from "../units";
import { createVenues, quoteAll } from "../venues";
import { parseArgs, str } from "./args";
import { renderPlan, renderReport } from "./render";

/**
 * yarn sdk:plan --net testnet --in WHBAR --out SAUCE --amount 10 [--slippage 50] [--step 5]
 * Quotes every venue, grid-searches a V1/V2 split, and prints the ExecutionPlan the app would execute.
 */
async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const net = parseNetwork(str(args.net, "testnet"));
  const cfg = configFromEnv(net);
  const tokenIn = resolveToken(cfg, str(args.in, "WHBAR"));
  const tokenOut = resolveToken(cfg, str(args.out, "SAUCE"));
  const amountIn = parseUnits(str(args.amount, "10"), tokenIn.decimals);
  const venues = createVenues(cfg);
  console.log(
    `${net}: plan ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol} → ${tokenOut.symbol}${net === "testnet" ? "  (demo liquidity)" : ""}`,
  );
  const reports = await quoteAll(venues, tokenIn, tokenOut, amountIn);
  for (const r of reports) console.log(renderReport(r, tokenOut.decimals));
  const requote: Requote = async (route, amt) => {
    const venue = venues.find(v => v.name === route.venue)!;
    const quotes = await venue.quoteExactInput(tokenIn, tokenOut, amt);
    return quotes.find(q => routeKey(q) === routeKey(route))?.amountOut;
  };
  try {
    const { plan, ranking, split } = await buildPlan({
      cfg,
      tokenIn,
      tokenOut,
      amountIn,
      reports,
      requote,
      slippageBps: Number(str(args.slippage, "50")),
      split: { stepPct: Number(str(args.step, "5")) },
    });
    console.log(`\n${renderPlan(plan, tokenIn.decimals, tokenOut.decimals)}`);
    if (split)
      console.log(
        `split search: ${split.requotes} re-quotes, best single ${formatUnits(split.bestSingleOut, tokenOut.decimals)}`,
      );
    for (const e of ranking.excluded) console.log(`excluded ${e.quote.venue}: ${e.reason}`);
    if (args.json) console.log(JSON.stringify(plan, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  } catch (e) {
    if (e instanceof NoRouteError) {
      console.log(`\nno executable route: ${e.message}`);
      process.exit(2);
    }
    throw e;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
