import { decodeEventLog, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import type { NetworkConfig } from "../config";
import { fetchJson } from "../http";
import { encodeLegPath } from "../router/plan";
import type { ExecutionPlan, ExecutionResult } from "../types";
import { tinybarToWeibar } from "../units";
import { erc20Abi } from "../venues/abi";

export const routerExecutorAbi = parseAbi([
  "struct Leg { uint8 venue; bytes path; uint256 amountIn; uint256 minOut; }",
  "function executeSplit(address tokenIn, address tokenOut, Leg[] legs, uint256 totalMinOut, uint256 deadline, address recipient, bool unwrapToHbar) payable returns (uint256 totalOut)",
  "event RouteExecuted(address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 totalOut, bytes32 planHash)",
]);

/** HIP-719 facade: `associate()` on the token's own address associates the caller. */
export const hip719Abi = parseAbi(["function associate() returns (int64)"]);

export type OnchainExecuteOptions = {
  cfg: NetworkConfig;
  executor: Address;
  publicClient: PublicClient;
  walletClient: WalletClient;
  /** Defaults to the wallet account. */
  recipient?: Address;
  /** Seconds the transaction stays valid (default 600). */
  deadlineSeconds?: number;
  fetchImpl?: typeof fetch;
  /** Called before each step so CLIs/UI can log. */
  onStep?: (step: string, detail?: string) => void;
};

export type Preflight = {
  associated: boolean;
  allowance: bigint;
  needsApproval: boolean;
  hbarIn: boolean;
  unwrap: boolean;
};

/** Read chain + mirror state: is the recipient associated with the output token, and is the executor allowed to pull the input? */
export async function preflightOnchain(plan: ExecutionPlan, o: OnchainExecuteOptions): Promise<Preflight> {
  const account = o.walletClient.account?.address as Address;
  const recipient = o.recipient ?? account;
  const hbarIn = Boolean(plan.tokenIn.native);
  const unwrap = Boolean(plan.tokenOut.native);
  let associated = unwrap;
  if (!unwrap) {
    const r = await fetchJson<{ tokens?: unknown[] }>(
      `${o.cfg.mirrorUrl}/api/v1/accounts/${recipient}/tokens?token.id=${plan.tokenOut.id}`,
      { fetchImpl: o.fetchImpl },
    ).catch(() => ({ tokens: [] }));
    associated = Boolean(r.tokens?.length);
  }
  const allowance = hbarIn
    ? plan.amountIn
    : ((await o.publicClient.readContract({
        address: plan.tokenIn.evm,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, o.executor],
      })) as bigint);
  return { associated, allowance, needsApproval: !hbarIn && allowance < plan.amountIn, hbarIn, unwrap };
}

/** Run the pre-flight transactions (HIP-719 association, ERC-20 approval) that the plan still needs. */
export async function prepareOnchain(plan: ExecutionPlan, o: OnchainExecuteOptions): Promise<Preflight> {
  const pre = await preflightOnchain(plan, o);
  const account = o.walletClient.account!;
  const chain = o.walletClient.chain;
  if (!pre.associated) {
    o.onStep?.("associate", plan.tokenOut.symbol);
    const hash = await o.walletClient.writeContract({
      account,
      chain,
      address: plan.tokenOut.evm,
      abi: hip719Abi,
      functionName: "associate",
      gas: 1_000_000n,
    });
    await o.publicClient.waitForTransactionReceipt({ hash });
  }
  if (pre.needsApproval) {
    o.onStep?.("approve", `${plan.amountIn} ${plan.tokenIn.symbol}`);
    const hash = await o.walletClient.writeContract({
      account,
      chain,
      address: plan.tokenIn.evm,
      abi: erc20Abi,
      functionName: "approve",
      args: [o.executor, plan.amountIn],
      gas: 1_000_000n,
    });
    await o.publicClient.waitForTransactionReceipt({ hash });
  }
  return { ...pre, associated: true, needsApproval: false };
}

/**
 * Execute an ONCHAIN_SPLIT plan through RouterExecutor and return what actually filled.
 * HBAR input is sent as `msg.value` in weibar (the contract sees tinybar); legs carry the WHBAR address.
 */
export async function executeOnchain(plan: ExecutionPlan, o: OnchainExecuteOptions): Promise<ExecutionResult> {
  if (plan.kind !== "ONCHAIN_SPLIT" || !plan.legs?.length)
    throw new Error("executeOnchain needs an ONCHAIN_SPLIT plan with legs");
  if (plan.network === "mainnet" && process.env.ALLOW_MAINNET_EXECUTION !== "true")
    throw new Error("mainnet execution is disabled (ALLOW_MAINNET_EXECUTION)");
  const account = o.walletClient.account!;
  const recipient = o.recipient ?? (account.address as Address);
  const whbar = o.cfg.tokens.WHBAR!.evm;
  const hbarIn = Boolean(plan.tokenIn.native);
  const unwrap = Boolean(plan.tokenOut.native);
  const legs = plan.legs.map(l => ({ venue: l.venue, path: encodeLegPath(l), amountIn: l.amountIn, minOut: l.minOut }));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (o.deadlineSeconds ?? 600));
  o.onStep?.("executeSplit", `${legs.length} leg(s), totalMinOut ${plan.totalMinOut}`);
  const hash = await o.walletClient.writeContract({
    account,
    chain: o.walletClient.chain,
    address: o.executor,
    abi: routerExecutorAbi,
    functionName: "executeSplit",
    args: [
      hbarIn ? whbar : plan.tokenIn.evm,
      unwrap ? whbar : plan.tokenOut.evm,
      legs,
      plan.totalMinOut,
      deadline,
      recipient,
      unwrap,
    ],
    value: hbarIn ? tinybarToWeibar(plan.amountIn) : 0n,
    gas: BigInt(600_000 + 1_200_000 * legs.length),
  });
  const rc = await o.publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`executeSplit reverted: ${hash}`);
  const ev = parseRouteExecuted(rc.logs);
  if (!ev) throw new Error(`RouteExecuted log not found in ${hash}`);
  if (ev.planHash.toLowerCase() !== plan.planHash.toLowerCase())
    throw new Error(`planHash mismatch: chain ${ev.planHash} vs plan ${plan.planHash}`);
  return {
    kind: plan.kind,
    planHash: plan.planHash,
    txHashes: [hash],
    filledIn: ev.amountIn,
    filledOut: ev.totalOut,
    refs: { contract: o.executor },
  };
}

export function parseRouteExecuted(
  logs: { data: Hex; topics: readonly Hex[] }[],
): { amountIn: bigint; totalOut: bigint; planHash: Hex } | undefined {
  for (const log of logs) {
    try {
      const ev = decodeEventLog({ abi: routerExecutorAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RouteExecuted")
        return { amountIn: ev.args.amountIn, totalOut: ev.args.totalOut, planHash: ev.args.planHash };
    } catch {
      /* other event */
    }
  }
  return undefined;
}
