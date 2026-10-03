import { encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from "viem";

/** The two client methods onboarding needs; any viem PublicClient (or a stub) satisfies it. */
export type ReadClient = Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
import type { NetworkConfig } from "../config";
import { fetchJson } from "../http";
import { hip719Abi } from "../execute/onchain";
import type { V3Book } from "../venues/SaucerV3";
import type { V3Auth } from "./auth";
import type { V3Domain } from "./signing";

/**
 * Before an account can trade a V3 book it must: be associated with both HTS tokens, have approved
 * Permit2 on each token (ERC-20 allowance), and have approved the reactor inside Permit2
 * (`permit2.approve(token, reactor, amount, expiration)`). This module reads the real chain state
 * (mirror + eth_call), compares it with `GET /onboarding/:id/status`, and returns the exact missing
 * transactions so a wallet or bot can send them one by one.
 */
export const reactorAbi = parseAbi(["function permit2() view returns (address)"]);
export const permit2Abi = parseAbi([
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
]);
export const erc20AllowanceAbi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export { hip719Abi };

export const MAX_UINT160 = (1n << 160n) - 1n;
export const MAX_UINT48 = (1n << 48n) - 1n;
export const MAX_UINT256 = (1n << 256n) - 1n;
/** HTS allowances are int64 on the ledger: approving more than this reverts with INVALID_OPERATION (seen on testnet). */
export const HTS_MAX_ALLOWANCE = (1n << 63n) - 1n;

/**
 * The largest allowance HTS accepts for a token: its max supply when the supply is finite
 * (AMOUNT_EXCEEDS_TOKEN_MAX_SUPPLY, code 289, otherwise), else the int64 ceiling.
 */
export async function maxAllowanceFor(cfg: NetworkConfig, tokenId: string, fetchImpl?: typeof fetch): Promise<bigint> {
  if (tokenId === "0.0.0") return MAX_UINT256;
  type Supply = { supply_type?: string; max_supply?: string };
  const t: Supply = await fetchJson<Supply>(`${cfg.mirrorUrl}/api/v1/tokens/${tokenId}`, { fetchImpl }).catch(
    () => ({}),
  );
  const max = t.max_supply ? BigInt(t.max_supply) : 0n;
  return t.supply_type === "FINITE" && max > 0n && max < HTS_MAX_ALLOWANCE ? max : HTS_MAX_ALLOWANCE;
}

export type OnboardingTx = { to: Address; data: Hex; gas: bigint; value?: bigint };

export type OnboardingStepKey =
  | "associateBaseToken"
  | "associateQuoteToken"
  | "approveBaseTokenPermit2"
  | "approveQuoteTokenPermit2"
  | "approveBaseTokenReactor"
  | "approveQuoteTokenReactor";

export type OnboardingStep = {
  key: OnboardingStepKey;
  label: string;
  token: Address;
  done: boolean;
  /** Present when not done: the transaction that completes the step. */
  tx?: OnboardingTx;
};

export type OnboardingReport = {
  account: Address;
  bookId: string;
  reactor: Address;
  permit2: Address;
  steps: OnboardingStep[];
  complete: boolean;
  /** What the API thinks, when a session is available (should agree with `steps`). */
  api?: { isComplete: boolean; pendingSteps: string[] };
};

export type OnboardingOptions = {
  cfg: NetworkConfig;
  publicClient: ReadClient;
  account: Address;
  book: V3Book;
  domain: V3Domain;
  auth?: V3Auth;
  fetchImpl?: typeof fetch;
  /** Amount to approve (default: unlimited). */
  amount?: bigint;
  /**
   * Input the next order needs (incl. fee headroom). A step counts as done when the standing allowance
   * still covers it; fills consume allowance, so comparing against the approved cap would flag a
   * healthy account as un-onboarded. Default 1 (any live allowance).
   */
  required?: bigint;
  /** Permit2 expiration (default: max uint48). */
  expiration?: bigint;
};

export async function fetchDomain(cfg: NetworkConfig, fetchImpl?: typeof fetch): Promise<V3Domain> {
  return fetchJson<V3Domain>(`${cfg.v3ApiUrl}/signature/domain`, { fetchImpl });
}

export async function readPermit2(publicClient: ReadClient, reactor: Address): Promise<Address> {
  return (await publicClient.readContract({ address: reactor, abi: reactorAbi, functionName: "permit2" })) as Address;
}

export async function isAssociated(
  cfg: NetworkConfig,
  account: Address,
  tokenId: string,
  fetchImpl?: typeof fetch,
): Promise<boolean> {
  if (tokenId === "0.0.0") return true; // native HBAR
  const r = await fetchJson<{ tokens?: unknown[] }>(
    `${cfg.mirrorUrl}/api/v1/accounts/${account}/tokens?token.id=${tokenId}`,
    { fetchImpl },
  ).catch(() => ({ tokens: [] }));
  return Boolean(r.tokens?.length);
}

/** Re-reads chain state every call (never trusts receipts): association, ERC-20 → Permit2, Permit2 → reactor. */
export async function checkOnboarding(o: OnboardingOptions): Promise<OnboardingReport> {
  const reactor = o.domain.verifyingContract;
  const permit2 = await readPermit2(o.publicClient, reactor);
  const amount = o.amount ?? MAX_UINT160;
  const need = o.required ?? 1n;
  const expiration = o.expiration ?? MAX_UINT48;
  const tokens: { side: "Base" | "Quote"; id: string; evm: Address; symbol: string | null }[] = [
    {
      side: "Base",
      id: o.book.baseTokenId,
      evm: o.book.baseTokenEvmAddress as Address,
      symbol: o.book.baseTokenSymbol,
    },
    {
      side: "Quote",
      id: o.book.quoteTokenId,
      evm: o.book.quoteTokenEvmAddress as Address,
      symbol: o.book.quoteTokenSymbol,
    },
  ];
  const steps: OnboardingStep[] = [];
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  for (const t of tokens) {
    const native = t.id === "0.0.0";
    const associated = await isAssociated(o.cfg, o.account, t.id, o.fetchImpl);
    steps.push({
      key: `associate${t.side}Token`,
      label: `Associate ${t.symbol ?? t.id}`,
      token: t.evm,
      done: associated,
      tx: associated
        ? undefined
        : { to: t.evm, data: encodeFunctionData({ abi: hip719Abi, functionName: "associate" }), gas: 1_000_000n },
    });
    const erc20Allowance = native
      ? MAX_UINT256
      : ((await o.publicClient.readContract({
          address: t.evm,
          abi: erc20AllowanceAbi,
          functionName: "allowance",
          args: [o.account, permit2],
        })) as bigint);
    const htsCap = native ? MAX_UINT256 : await maxAllowanceFor(o.cfg, t.id, o.fetchImpl);
    const erc20Target = amount < htsCap ? amount : htsCap;
    const p2ok = erc20Allowance >= need;
    steps.push({
      key: `approve${t.side}TokenPermit2`,
      label: `Approve Permit2 to spend ${t.symbol ?? t.id}`,
      token: t.evm,
      done: p2ok,
      tx: p2ok
        ? undefined
        : {
            to: t.evm,
            data: encodeFunctionData({
              abi: erc20AllowanceAbi,
              functionName: "approve",
              args: [permit2, erc20Target],
            }),
            gas: 2_000_000n,
          },
    });
    const [p2amount, p2exp] = native
      ? [MAX_UINT160, MAX_UINT48]
      : ((await o.publicClient.readContract({
          address: permit2,
          abi: permit2Abi,
          functionName: "allowance",
          args: [o.account, t.evm, reactor],
        })) as readonly [bigint, number | bigint, number | bigint]);
    const rok = BigInt(p2amount) >= need && BigInt(p2exp) > nowSec;
    steps.push({
      key: `approve${t.side}TokenReactor`,
      label: `Approve the reactor inside Permit2 for ${t.symbol ?? t.id}`,
      token: t.evm,
      done: rok,
      tx: rok
        ? undefined
        : {
            to: permit2,
            data: encodeFunctionData({
              abi: permit2Abi,
              functionName: "approve",
              args: [t.evm, reactor, amount, Number(expiration)],
            }),
            gas: 1_500_000n,
          },
    });
  }
  let api: OnboardingReport["api"];
  if (o.auth) {
    api = await o.auth
      .withAuth(h =>
        fetchJson<{ isComplete: boolean; pendingSteps: string[] }>(`${o.cfg.v3ApiUrl}/onboarding/${o.book.id}/status`, {
          headers: h,
          fetchImpl: o.fetchImpl,
        }),
      )
      .then(r => ({ isComplete: r.isComplete, pendingSteps: r.pendingSteps }))
      .catch(() => undefined);
  }
  return { account: o.account, bookId: o.book.id, reactor, permit2, steps, complete: steps.every(s => s.done), api };
}

export type OnboardingWallet = {
  account: { address: Address };
  sendTransaction: (tx: OnboardingTx & { account: { address: Address }; chain: undefined }) => Promise<Hex>;
};

/** Send every missing step with a wallet client, re-verifying on chain after each one. */
export async function runOnboarding(
  o: OnboardingOptions & { walletClient: OnboardingWallet; onStep?: (s: OnboardingStep, hash: Hex) => void },
): Promise<OnboardingReport> {
  let report = await checkOnboarding(o);
  for (const step of report.steps) {
    if (step.done || !step.tx) continue;
    const hash = await o.walletClient.sendTransaction({
      ...step.tx,
      account: o.walletClient.account,
      chain: undefined,
    });
    await o.publicClient.waitForTransactionReceipt({ hash });
    o.onStep?.(step, hash);
    report = await checkOnboarding(o);
    const again = report.steps.find(s => s.key === step.key);
    if (!again?.done) throw new Error(`onboarding step ${step.key} did not take effect on chain (tx ${hash})`);
  }
  return report;
}
