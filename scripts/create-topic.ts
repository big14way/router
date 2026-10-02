/**
 * Create the HCS receipts topic with the operator as submit key and print the env line to add.
 *   yarn topic:create [--net testnet]
 * Needs HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in the root .env (never committed).
 */
import { config as dotenv } from "dotenv";
import path from "node:path";
import { createReceiptsTopic, parseNetwork } from "../packages/router-sdk/src";

dotenv({ path: path.join(process.cwd(), ".env") });

async function main() {
  const net = parseNetwork(process.argv.includes("--net") ? process.argv[process.argv.indexOf("--net") + 1] : "testnet");
  const operatorId = process.env.HEDERA_OPERATOR_ID;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY;
  if (!operatorId || !operatorKey) throw new Error("set HEDERA_OPERATOR_ID and HEDERA_OPERATOR_KEY in .env");
  const topicId = await createReceiptsTopic({ operatorId, operatorKey }, net);
  console.log(`created receipts topic on ${net}: ${topicId}`);
  console.log(`https://hashscan.io/${net}/topic/${topicId}`);
  console.log(`\nadd to .env:\nNEXT_PUBLIC_RECEIPTS_TOPIC_ID=${topicId}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
