/**
 * Seed demo liquidity on Hedera testnet so a split can beat any single venue:
 *   - create two HTS tokens (TKA, TKB)
 *   - V1 pair TKA/TKB (shallow, better price) and V1 pairs TKA/WHBAR + WHBAR/TKB (deeper via-WHBAR route)
 *   - V2 pool TKA/TKB on the 0.30 % tier, only if the live pool-creation fee is affordable
 * Prints the env lines to add. Idempotent-ish: re-running creates new tokens; pass --tka/--tkb to reuse.
 *
 *   yarn seed:testnet [--max-fee-hbar 50] [--tka 0.0.x --tkb 0.0.y]
 * Needs DEPLOYER_PRIVATE_KEY (ECDSA hex) in the root .env; the operator account is resolved from its EVM address.
 */
import {
  AccountAllowanceApproveTransaction,
  AccountId,
  AccountUpdateTransaction,
  Client,
  ContractExecuteTransaction,
  ContractId,
  Hbar,
  PrivateKey,
  TokenCreateTransaction,
  TokenId,
} from "@hiero-ledger/sdk";
import { config as dotenv } from "dotenv";
import path from "node:path";
import { createPublicClient, encodeFunctionData, hexToBytes, http, parseAbi, type Address } from "viem";
import { testnet } from "../packages/router-sdk/src/config";
import { addressToEntity, entityToAddress, parseUnits } from "../packages/router-sdk/src/units";

dotenv({ path: path.join(process.cwd(), ".env") });

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1]! : d);
const MAX_FEE_HBAR = Number(opt("--max-fee-hbar", "50"));
const DEC = 8;
const units = (n: string) => parseUnits(n, DEC);

/** Pool sizes: direct pair is shallow with the better price; the via-WHBAR legs are deeper with a worse price. */
const DIRECT = { tka: units("10000"), tkb: units("22000") }; // 1 TKA = 2.2 TKB
const VIA_A = { tka: units("200000"), hbar: 10 }; // 1 HBAR = 20000 TKA
const VIA_B = { tkb: units("400000"), hbar: 10 }; // 1 HBAR = 40000 TKB → 1 TKA = 2 TKB via WHBAR
const V2 = { tka: units("5000"), tkb: units("11000"), fee: 3000, tickSpacing: 60 };

const v1RouterAbi = parseAbi([
  "function addLiquidityNewPool(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) payable returns (uint amountA, uint amountB, uint liquidity)",
  "function addLiquidityETHNewPool(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) payable returns (uint amountToken, uint amountETH, uint liquidity)",
]);
const factoryAbi = parseAbi([
  "function pairCreateFee() view returns (uint256)",
  "function getPair(address,address) view returns (address)",
  "function poolCreateFee() view returns (uint256)",
  "function mintFee() view returns (uint256)",
  "function getPool(address,address,uint24) view returns (address)",
]);
const npmAbi = parseAbi([
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline) params) payable returns (uint256 tokenSN, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function refundETH() payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

const evm = createPublicClient({ transport: http(testnet.rpcUrl) });

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("DEPLOYER_PRIVATE_KEY missing in .env");
  const key = PrivateKey.fromStringECDSA(pk.replace(/^0x/, ""));
  const evmAddress = `0x${key.publicKey.toEvmAddress()}` as Address;
  const acct = await (await fetch(`${testnet.mirrorUrl}/api/v1/accounts/${evmAddress}`)).json();
  if (!acct.account) throw new Error(`account for ${evmAddress} not found on testnet; fund it at https://portal.hedera.com/faucet`);
  const operatorId = AccountId.fromString(acct.account);
  const client = Client.forTestnet().setOperator(operatorId, key);
  const log = (m: string) => console.log(`[seed] ${m}`);
  log(`operator ${operatorId} (${evmAddress}) balance ${(acct.balance.balance / 1e8).toFixed(2)} HBAR`);

  const rate = (await (await fetch(`${testnet.mirrorUrl}/api/v1/network/exchangerate`)).json()).current_rate;
  const tinycentToHbar = (tc: bigint) => Number(tc) * rate.hbar_equivalent / rate.cent_equivalent / 1e8;
  const pairFee = await evm.readContract({ address: testnet.saucer.v1Factory, abi: factoryAbi, functionName: "pairCreateFee" });
  const poolFee = await evm.readContract({ address: testnet.saucer.v2Factory, abi: factoryAbi, functionName: "poolCreateFee" });
  const mintFee = await evm.readContract({ address: testnet.saucer.v2Factory, abi: factoryAbi, functionName: "mintFee" });
  log(`fees: V1 pairCreateFee ≈ ${tinycentToHbar(pairFee).toFixed(2)} HBAR, V2 poolCreateFee ≈ ${tinycentToHbar(poolFee).toFixed(2)} HBAR, V2 mintFee ≈ ${tinycentToHbar(mintFee).toFixed(4)} HBAR`);

  // Unlimited auto-association so LP tokens / the V2 position NFT land without extra transactions.
  await (await new AccountUpdateTransaction().setAccountId(operatorId).setMaxAutomaticTokenAssociations(-1).execute(client)).getReceipt(client);
  log("auto-association set to unlimited");

  const tka = argv.includes("--tka") ? TokenId.fromString(opt("--tka", "")) : await createToken(client, operatorId, key, "Router Demo Token A", "TKA");
  const tkb = argv.includes("--tkb") ? TokenId.fromString(opt("--tkb", "")) : await createToken(client, operatorId, key, "Router Demo Token B", "TKB");
  log(`TKA ${tka} ${entityToAddress(tka.toString())}`);
  log(`TKB ${tkb} ${entityToAddress(tkb.toString())}`);
  const A = entityToAddress(tka.toString());
  const B = entityToAddress(tkb.toString());
  const to = evmAddress;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const v1Router = AccountId.fromString(addressToEntity(testnet.saucer.v1Router));
  await approve(client, operatorId, tka, v1Router, DIRECT.tka + VIA_A.tka + V2.tka);
  await approve(client, operatorId, tkb, v1Router, DIRECT.tkb + VIA_B.tkb + V2.tkb);
  log("router allowances granted");

  const feeHbar = Hbar.fromTinybars(Math.ceil(tinycentToHbar(pairFee) * 1e8 * 1.02));
  // Direct TKA/TKB pair
  await contractCall(client, testnet.saucer.v1Router, encodeFunctionData({ abi: v1RouterAbi, functionName: "addLiquidityNewPool", args: [A, B, DIRECT.tka, DIRECT.tkb, DIRECT.tka, DIRECT.tkb, to, deadline] }), feeHbar, 12_000_000);
  log(`V1 pair TKA/TKB created: ${await pair(A, B)}`);
  // Via-WHBAR legs (HBAR side paid as value on top of the fee)
  await contractCall(client, testnet.saucer.v1Router, encodeFunctionData({ abi: v1RouterAbi, functionName: "addLiquidityETHNewPool", args: [A, VIA_A.tka, VIA_A.tka, 0n, to, deadline] }), Hbar.fromTinybars(feeHbar.toTinybars().toNumber() + VIA_A.hbar * 1e8), 12_000_000);
  log(`V1 pair TKA/WHBAR created: ${await pair(A, testnet.tokens.WHBAR!.evm)}`);
  await contractCall(client, testnet.saucer.v1Router, encodeFunctionData({ abi: v1RouterAbi, functionName: "addLiquidityETHNewPool", args: [B, VIA_B.tkb, VIA_B.tkb, 0n, to, deadline] }), Hbar.fromTinybars(feeHbar.toTinybars().toNumber() + VIA_B.hbar * 1e8), 12_000_000);
  log(`V1 pair WHBAR/TKB created: ${await pair(B, testnet.tokens.WHBAR!.evm)}`);

  let v2Note = "skipped";
  const v2FeeHbar = tinycentToHbar(poolFee) + tinycentToHbar(mintFee);
  if (v2FeeHbar <= MAX_FEE_HBAR) {
    const [t0, t1, a0, a1] = A.toLowerCase() < B.toLowerCase() ? [A, B, V2.tka, V2.tkb] : [B, A, V2.tkb, V2.tka];
    const price = Number(a1) / Number(a0); // token1 per token0
    const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(price) * 2 ** 96));
    const npm = AccountId.fromString(addressToEntity(testnet.saucer.v2PositionManager));
    await approve(client, operatorId, tka, npm, V2.tka);
    await approve(client, operatorId, tkb, npm, V2.tkb);
    const tick = 887220 - (887220 % V2.tickSpacing);
    const calls = [
      encodeFunctionData({ abi: npmAbi, functionName: "createAndInitializePoolIfNecessary", args: [t0, t1, V2.fee, sqrtPriceX96] }),
      encodeFunctionData({ abi: npmAbi, functionName: "mint", args: [{ token0: t0, token1: t1, fee: V2.fee, tickLower: -tick, tickUpper: tick, amount0Desired: a0, amount1Desired: a1, amount0Min: 0n, amount1Min: 0n, recipient: to, deadline }] }),
      encodeFunctionData({ abi: npmAbi, functionName: "refundETH" }),
    ];
    await contractCall(client, testnet.saucer.v2PositionManager, encodeFunctionData({ abi: npmAbi, functionName: "multicall", args: [calls] }), Hbar.fromTinybars(Math.ceil(v2FeeHbar * 1e8 * 1.02)), 12_000_000);
    const pool = await evm.readContract({ address: testnet.saucer.v2Factory, abi: factoryAbi, functionName: "getPool", args: [t0, t1, V2.fee] });
    v2Note = `pool ${pool}`;
    log(`V2 pool TKA/TKB (0.30 %) created: ${pool}`);
  } else {
    log(`V2 pool creation skipped: fee ≈ ${v2FeeHbar.toFixed(2)} HBAR exceeds --max-fee-hbar ${MAX_FEE_HBAR}`);
  }

  console.log(`\nadd to .env:\nHEDERA_OPERATOR_ID=${operatorId}\nHEDERA_OPERATOR_KEY=${"<same key as DEPLOYER_PRIVATE_KEY>"}\nNEXT_PUBLIC_EXTRA_TOKENS=TKA:${tka}:${DEC},TKB:${tkb}:${DEC}`);
  console.log(`\nthen: yarn sdk:plan --net testnet --in TKA --out TKB --amount 1000   (V2: ${v2Note})`);
  console.log(`hashscan: https://hashscan.io/testnet/token/${tka}  https://hashscan.io/testnet/token/${tkb}`);
  client.close();

  async function pair(x: Address, y: Address): Promise<string> {
    const p = await evm.readContract({ address: testnet.saucer.v1Factory, abi: factoryAbi, functionName: "getPair", args: [x, y] });
    return `${p} (https://hashscan.io/testnet/contract/${p})`;
  }
}

async function createToken(client: Client, treasury: AccountId, key: PrivateKey, name: string, symbol: string): Promise<TokenId> {
  const tx = await new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setDecimals(DEC)
    .setInitialSupply(1_000_000n * 10n ** BigInt(DEC))
    .setTreasuryAccountId(treasury)
    .setSupplyKey(key.publicKey)
    .setTokenMemo("hedera-smart-order-router demo liquidity")
    .execute(client);
  const rc = await tx.getReceipt(client);
  if (!rc.tokenId) throw new Error(`token ${symbol} not created`);
  return rc.tokenId;
}

async function approve(client: Client, owner: AccountId, token: TokenId, spender: AccountId, amount: bigint) {
  await (await new AccountAllowanceApproveTransaction().approveTokenAllowance(token, owner, spender, amount).execute(client)).getReceipt(client);
}

async function contractCall(client: Client, contract: Address, data: `0x${string}`, value: Hbar, gas: number) {
  const tx = await new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(addressToEntity(contract)))
    .setGas(gas)
    .setPayableAmount(value)
    .setFunctionParameters(hexToBytes(data))
    .execute(client);
  const rc = await tx.getReceipt(client);
  if (rc.status.toString() !== "SUCCESS") throw new Error(`contract call failed: ${rc.status}`);
  console.log(`[seed]   tx ${tx.transactionId} https://hashscan.io/testnet/transaction/${tx.transactionId}`);
  return rc;
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
