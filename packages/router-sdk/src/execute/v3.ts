import type { Address, Hex } from "viem";
import type { NetworkConfig } from "../config";
import type { ExecutionPlan, ExecutionResult } from "../types";
import type { V3Book } from "../venues/SaucerV3";
import type { V3Auth } from "./../v3/auth";
import {
  checkOnboarding,
  fetchDomain,
  runOnboarding,
  type OnboardingReport,
  type OnboardingWallet,
  type ReadClient,
} from "../v3/onboarding";
import { V3Orders, type OrderEvent, type OrderSigner } from "../v3/orders";
import { awaitTerminal, type UserEvents } from "../v3/ws";

/**
 * `Venue.execute` for plans of kind `V3_MARKET`: onboarding → quote → build → sign → save →
 * terminal event → settlement transaction(s). Mainnet is guarded by ALLOW_MAINNET_EXECUTION and a
 * per-order notional cap.
 */
export type V3ExecuteOptions = {
  cfg: NetworkConfig;
  auth: V3Auth;
  orders?: V3Orders;
  publicClient: ReadClient;
  /** The swapper's EVM address (what `info.swapper` must equal). */
  account: Address;
  /** Produces the mode-prefixed signature for the built order (bot 0x00 or wallet 0x01). */
  sign: OrderSigner;
  /** When present, missing onboarding steps are sent; otherwise they are reported as an error. */
  walletClient?: OnboardingWallet;
  events?: UserEvents;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onStep?: (step: string, detail?: string) => void;
  /** USD value of the input, used for the mainnet cap (caller computes it from a price source). */
  notionalUsd?: number;
  env?: Record<string, string | undefined>;
};

export class OnboardingRequired extends Error {
  constructor(public readonly report: OnboardingReport) {
    super(
      `account ${report.account} is not onboarded for book ${report.bookId}: ${report.steps
        .filter(s => !s.done)
        .map(s => s.key)
        .join(", ")}`,
    );
    this.name = "OnboardingRequired";
  }
}

export function assertMainnetAllowed(
  network: string,
  notionalUsd: number | undefined,
  env: Record<string, string | undefined> = process.env,
): void {
  if (network !== "mainnet") return;
  if (env.ALLOW_MAINNET_EXECUTION !== "true")
    throw new Error("mainnet execution is disabled (ALLOW_MAINNET_EXECUTION)");
  const cap = Number(env.MAINNET_MAX_NOTIONAL_USD ?? "20");
  if (notionalUsd === undefined)
    throw new Error("mainnet execution needs the order's USD notional to enforce MAINNET_MAX_NOTIONAL_USD");
  if (notionalUsd > cap) throw new Error(`order notional ${notionalUsd} USD exceeds MAINNET_MAX_NOTIONAL_USD=${cap}`);
}

export async function executeV3(plan: ExecutionPlan, o: V3ExecuteOptions): Promise<ExecutionResult> {
  if (plan.kind !== "V3_MARKET" || !plan.order?.bookId)
    throw new Error("executeV3 needs a V3_MARKET plan with a bookId");
  assertMainnetAllowed(plan.network, o.notionalUsd, o.env);
  const orders = o.orders ?? new V3Orders(o.cfg, o.auth, o.fetchImpl);
  const book = (await orders.books()).find(b => b.id === plan.order!.bookId);
  if (!book) throw new Error(`book ${plan.order.bookId} not found`);
  const domain = await fetchDomain(o.cfg, o.fetchImpl);

  o.onStep?.("onboarding", `book ${book.id}`);
  const base = {
    cfg: o.cfg,
    publicClient: o.publicClient,
    account: o.account,
    book,
    domain,
    auth: o.auth,
    fetchImpl: o.fetchImpl,
  };
  const report = o.walletClient
    ? await runOnboarding({ ...base, walletClient: o.walletClient })
    : await checkOnboarding(base);
  if (!report.complete) throw new OnboardingRequired(report);

  const inputToken = (plan.order.side === "SELL" ? book.baseTokenEvmAddress : book.quoteTokenEvmAddress) as Address;
  o.onStep?.("quote", `${plan.amountIn} of ${inputToken}`);
  const { quote, request } = await orders.quoteThenBuildMarket(book, inputToken, plan.amountIn.toString(), o.account);
  if (BigInt(quote.suggestedOutputAmount) < plan.totalMinOut) {
    throw new Error(
      `fresh quote ${quote.suggestedOutputAmount} is below the plan floor ${plan.totalMinOut}; not placing`,
    );
  }
  o.onStep?.("place", `market ${request.inputAmount} → ≥ ${request.outputAmount}`);
  const { saved, built } = await orders.place(request, o.sign);
  const orderId = String(saved.meta?.id ?? "");
  if (!orderId) throw new Error(`save returned no order id (status ${saved.meta?.status})`);
  o.onStep?.("saved", `order ${orderId} status ${saved.meta?.status}`);

  const terminal = await awaitTerminal(orders, orderId, { events: o.events, timeoutMs: o.timeoutMs });
  o.onStep?.("terminal", terminalName(terminal));
  if (terminalName(terminal) !== "ORDER_FILLED")
    throw new Error(`order ${orderId} ended with ${terminalName(terminal)}`);
  const settlement = settlementIds(terminal, await orders.history(orderId));
  const filledOut = BigInt(String(terminal.filledOutput ?? terminal.outputAmount ?? quote.expectedOutputAmount));
  const filledIn = BigInt(String(terminal.filledInput ?? terminal.inputAmount ?? request.inputAmount));
  return {
    kind: plan.kind,
    planHash: plan.planHash,
    txHashes: settlement,
    filledIn,
    filledOut,
    refs: { orderId, nonce: built.info.nonce, bookId: book.id },
  };
}

const terminalName = (e: OrderEvent): string => String(e.type ?? e.event ?? e.status ?? "").toUpperCase();

/** Settlement transaction ids/hashes from the terminal event and the history (either field name the API uses). */
export function settlementIds(terminal: OrderEvent, history: OrderEvent[]): string[] {
  const ids = new Set<string>();
  for (const e of [terminal, ...history]) {
    for (const k of ["transactionHash", "txHash", "transactionId", "settlementTransactionId"]) {
      const v = e[k];
      if (typeof v === "string" && v) ids.add(v);
    }
    const fills = e.fills as { transactionHash?: string; txHash?: string }[] | undefined;
    for (const f of fills ?? []) {
      const v = f.transactionHash ?? f.txHash;
      if (v) ids.add(v);
    }
  }
  return [...ids];
}

export type { V3Book };
export type V3SignatureHex = Hex;
