/** Shared setup for the V3 scripts: bot key, account, auth, clients. Bot = V3_BOT_* or the deployer key. */
import { PrivateKey } from "@hiero-ledger/sdk";
import { config as dotenv } from "dotenv";
import path from "node:path";
import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hedera, hederaTestnet } from "viem/chains";
import {
  configFromEnv,
  parseNetwork,
  signerFromHieroKey,
  V3Auth,
  V3Orders,
  type NetworkConfig,
  type OnboardingWallet,
} from "../packages/router-sdk/src";

dotenv({ path: path.join(process.cwd(), ".env") });

export const argv = process.argv.slice(2);
export const opt = (k: string, d: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1]! : d);
export const log = (m: string) => console.log(`[v3] ${m}`);
export const raw = (label: string, v: unknown) => console.log(`[v3] ${label}: ${JSON.stringify(v)}`);

export type BotContext = {
  cfg: NetworkConfig;
  accountId: string;
  evm: Address;
  keyType: "ECDSA_SECP256K1" | "ED25519";
  hieroKey: PrivateKey;
  auth: V3Auth;
  orders: V3Orders;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient?: ReturnType<typeof createWalletClient>;
  /** Adapter the SDK onboarding uses to send the missing transactions. */
  onboardingWallet?: OnboardingWallet;
  privateKeyHex?: `0x${string}`;
};

export async function botContext(): Promise<BotContext> {
  const net = parseNetwork(opt("--net", "testnet"));
  const cfg = configFromEnv(net);
  const rawKey = (process.env.V3_BOT_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY ?? "").trim();
  if (!rawKey) throw new Error("set V3_BOT_PRIVATE_KEY (or DEPLOYER_PRIVATE_KEY) in .env");
  const hex = rawKey.replace(/^0x/, "");
  const isDer = hex.startsWith("302");
  const hieroKey = isDer ? PrivateKey.fromStringDer(hex) : process.env.V3_BOT_KEY_TYPE === "ED25519" ? PrivateKey.fromStringED25519(hex) : PrivateKey.fromStringECDSA(hex);
  const keyType = hieroKey.type === "ED25519" ? "ED25519" : "ECDSA_SECP256K1";
  let accountId = process.env.V3_BOT_ACCOUNT_ID;
  let evm: Address;
  if (keyType === "ECDSA_SECP256K1") {
    evm = `0x${hieroKey.publicKey.toEvmAddress()}` as Address;
    if (!accountId) {
      const a = await (await fetch(`${cfg.mirrorUrl}/api/v1/accounts/${evm}`)).json();
      accountId = a.account;
      if (!accountId) throw new Error(`no ${net} account for ${evm}; fund it first`);
    }
  } else {
    if (!accountId) throw new Error("ED25519 bots need V3_BOT_ACCOUNT_ID");
    const a = await (await fetch(`${cfg.mirrorUrl}/api/v1/accounts/${accountId}`)).json();
    evm = a.evm_address as Address;
  }
  const auth = new V3Auth(cfg, signerFromHieroKey(accountId!, hieroKey));
  const orders = new V3Orders(cfg, auth);
  const chain = net === "mainnet" ? hedera : hederaTestnet;
  const publicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const privateKeyHex = keyType === "ECDSA_SECP256K1" && !isDer ? (`0x${hex}` as `0x${string}`) : undefined;
  const walletClient = privateKeyHex ? createWalletClient({ account: privateKeyToAccount(privateKeyHex), chain, transport: http(cfg.rpcUrl) }) : undefined;
  const onboardingWallet: OnboardingWallet | undefined = walletClient
    ? {
        account: { address: evm },
        // Explicit legacy gas price: the relay rejects viem's EIP-1559 defaults ("gas price below minimum").
        sendTransaction: async tx =>
          walletClient.sendTransaction({
            to: tx.to,
            data: tx.data,
            gas: tx.gas,
            value: tx.value,
            gasPrice: await publicClient.getGasPrice(),
            account: walletClient.account!,
            chain,
          }),
      }
    : undefined;
  log(`${net} bot ${accountId} (${evm}, ${keyType})`);
  return { cfg, accountId: accountId!, evm, keyType, hieroKey, auth, orders, publicClient, walletClient, onboardingWallet, privateKeyHex };
}
