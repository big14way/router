import { configFromEnv, parseNetwork } from "../config";
import { resolveToken } from "../tokens";
import type { Quote, VenueReport } from "../types";
import { formatUnits, parseUnits } from "../units";
import { createVenues, quoteAll } from "../venues";
import { parseArgs, str } from "./args";

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

export function renderReport(r: VenueReport, decimals: number): string {
  const head = `${r.venue.padEnd(11)} ${r.status.ok ? "executable" : `unavailable: ${r.status.reason}`}  (${r.latencyMs} ms)`;
  if (!r.quotes.length) return head;
  return [head, ...r.quotes.map(q => `  ${renderQuote(q, decimals)}`)].join("\n");
}

export function renderQuote(q: Quote, decimals: number): string {
  const route =
    q.venue === "SAUCER_V1"
      ? `path ${(q.path as string[]).map(short).join(" → ")}`
      : q.venue === "SAUCER_V2"
        ? `fees ${q.fees?.join("/")}`
        : q.venue === "SAUCER_V3"
          ? `book ${q.bookId} ${q.side}`
          : `${q.symbol} ${q.side}`;
  const flags = `${q.fillable ? "fillable" : "NOT fillable"}${q.minNotionalOk ? "" : ", below minNotional"}`;
  const gas = q.gasEstimate ? `, gas ${q.gasEstimate}` : "";
  const fee = q.feeOut ? `, fee ${formatUnits(q.feeOut, decimals)}` : "";
  return `${route.padEnd(28)} out ${formatUnits(q.amountOut, decimals)}  [${flags}${gas}${fee}]`;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

main().catch(e => {
  console.error(e);
  process.exit(1);
});
