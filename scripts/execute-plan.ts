/**
 * Plan and execute a swap from the terminal with the deployer key, publish the HCS receipt and verify it.
 *   yarn execute:plan --net testnet --in HBAR --out SAUCE --amount 1 [--slippage 50] [--step 10]
 * Needs DEPLOYER_PRIVATE_KEY, NEXT_PUBLIC_ROUTER_EXECUTOR, HEDERA_OPERATOR_ID/KEY and NEXT_PUBLIC_RECEIPTS_TOPIC_ID in .env.
 * Mainnet is refused unless ALLOW_MAINNET_EXECUTION=true.
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hedera, hederaTestnet } from "viem/chains";
import {
  buildPlan,
  configFromEnv,
  createVenues,
  executeOnchain,
  formatUnits,
  parseNetwork,
  parseUnits,
  prepareOnchain,
  publishReceipt,
  quoteAll,
  receiptFromPlan,
  resolveToken,
  routeKey,
  verifyReceipt,
  type Requote,
} from "../packages/router-sdk/src";

dotenv({ path: path.join(process.cwd(), ".env") });
const argv = process.argv.slice(2);
const opt = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1]! : d);

async function main() {
  const net = parseNetwork(opt("--net", "testnet"));
  const cfg = configFromEnv(net);
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  const executor = process.env.NEXT_PUBLIC_ROUTER_EXECUTOR as Address | undefined;
  if (!pk || !executor) throw new Error("DEPLOYER_PRIVATE_KEY and NEXT_PUBLIC_ROUTER_EXECUTOR are required");
  const account = privateKeyToAccount(pk as `0x${string}`);
  const chain = net === "mainnet" ? hedera : hederaTestnet;
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpcUrl) });
  const tokenIn = resolveToken(cfg, opt("--in", "HBAR"));
  const tokenOut = resolveToken(cfg, opt("--out", "SAUCE"));
  const amountIn = parseUnits(opt("--amount", "1"), tokenIn.decimals);
  const log = (m: string) => console.log(`[execute] ${m}`);
  log(`${net} ${account.address}: ${formatUnits(amountIn, tokenIn.decimals)} ${tokenIn.symbol} → ${tokenOut.symbol} via ${executor}`);

  const venues = createVenues(cfg);
  const reports = await quoteAll(venues, tokenIn, tokenOut, amountIn);
  const requote: Requote = async (route, amt) => (await venues.find(v => v.name === route.venue)!.quoteExactInput(tokenIn, tokenOut, amt)).find(x => routeKey(x) === routeKey(route))?.amountOut;
  const { plan } = await buildPlan({ cfg, tokenIn, tokenOut, amountIn, reports, requote, slippageBps: Number(opt("--slippage", "50")), split: { stepPct: Number(opt("--step", "10")) } });
  log(`plan ${plan.kind}: ${formatUnits(plan.totalOut, tokenOut.decimals)} ${tokenOut.symbol} (min ${formatUnits(plan.totalMinOut, tokenOut.decimals)}), best single ${plan.bestSingleVenue.venue} ${formatUnits(plan.bestSingleVenue.amountOut, tokenOut.decimals)}`);
  for (const l of plan.legs ?? []) log(`  leg ${l.venue === 0 ? "V1" : "V2"} ${formatUnits(l.amountIn, tokenIn.decimals)} → ${formatUnits(l.amountOut, tokenOut.decimals)}`);
  log(`planHash ${plan.planHash}`);
  if (plan.kind !== "ONCHAIN_SPLIT") throw new Error(`plan kind ${plan.kind} is executed through the app's signed-order flow, not this script`);

  const o = { cfg, executor, publicClient, walletClient, onStep: (s: string, d?: string) => log(`${s} ${d ?? ""}`) };
  await prepareOnchain(plan, o);
  const result = await executeOnchain(plan, o);
  const tx = result.txHashes[0]!;
  log(`filled ${formatUnits(result.filledIn, tokenIn.decimals)} ${tokenIn.symbol} → ${formatUnits(result.filledOut, tokenOut.decimals)} ${tokenOut.symbol}`);
  log(`tx ${cfg.hashscanUrl}/transaction/${tx}`);
  log(`mirror ${cfg.mirrorUrl}/api/v1/contracts/results/${tx}`);

  const creds = { operatorId: process.env.HEDERA_OPERATOR_ID ?? "", operatorKey: process.env.HEDERA_OPERATOR_KEY ?? "", topicId: process.env.NEXT_PUBLIC_RECEIPTS_TOPIC_ID ?? "" };
  const receipt = receiptFromPlan(plan, { txHashes: result.txHashes, filledIn: result.filledIn, filledOut: result.filledOut, account: account.address });
  const pub = await publishReceipt(receipt, creds, net);
  log(`receipt published: topic ${pub.topicId} sequence ${pub.sequenceNumber} (${pub.transactionId})`);
  log(`mirror ${cfg.mirrorUrl}/api/v1/topics/${pub.topicId}/messages/${pub.sequenceNumber}`);
  await new Promise(r => setTimeout(r, 8000)); // mirror node lag
  const v = await verifyReceipt(cfg, creds.topicId, plan.planHash);
  for (const c of v.checks) log(`${c.ok ? "✅" : "❌"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
  log(`verified: ${v.verified}`);
  console.log(JSON.stringify({ executor, tx, planHash: plan.planHash, topicId: pub.topicId, sequenceNumber: pub.sequenceNumber, verified: v.verified }, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
