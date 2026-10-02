import { configFromEnv, parseNetwork } from "../config";
import { resolveToken } from "../tokens";
import { formatUnits, parseUnits } from "../units";
import { createVenues, quoteAll } from "../venues";
import { parseArgs, str } from "./args";
import { renderReport } from "./render";

/**
 * yarn sdk:quote --net testnet --in WHBAR --out SAUCE --amount 10
 * Prints every venue's best executable quote plus a status line per venue. Read-only on every network.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const net = parseNetwork(str(args.net, "testnet"));
  const cfg = configFromEnv(net);
  const tokenIn = resolveToken(cfg, str(args.in, "WHBAR"));
  const tokenOut = resolveToken(cfg, str(args.out, "SAUCE"));
  const amountIn = parseUnits(str(args.amount, "10"), tokenIn.decimals);
  const lambdaplex =
    process.env.LAMBDAPLEX_API_KEY && process.env.LAMBDAPLEX_ED25519_SEED
      ? { credentials: { apiKey: process.env.LAMBDAPLEX_API_KEY, ed25519Seed: process.env.LAMBDAPLEX_ED25519_SEED } }
      : undefined;
  const venues = createVenues(cfg, { lambdaplex });
  console.log(
    `${net}: ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol} → ${tokenOut.symbol}${net === "testnet" ? "  (demo liquidity)" : ""}`,
  );
  const reports = await quoteAll(venues, tokenIn, tokenOut, amountIn);
  for (const r of reports) console.log(renderReport(r, tokenOut.decimals));
  const best = reports
    .flatMap(r => r.quotes)
    .filter(q => q.fillable)
    .sort((a, b) => (b.amountOut > a.amountOut ? 1 : -1))[0];
  if (best)
    console.log(
      `\nbest single venue: ${best.venue} → ${formatUnits(best.amountOut, tokenOut.decimals)} ${tokenOut.symbol}`,
    );
  if (args.json) console.log(JSON.stringify(reports, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
