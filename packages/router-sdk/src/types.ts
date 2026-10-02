import type { Address, Hex } from "viem";

export type Network = "testnet" | "mainnet";

export type VenueName = "SAUCER_V1" | "SAUCER_V2" | "SAUCER_V3" | "LAMBDAPLEX";

/** A token the router can quote. `id` is the Hedera entity ID; `evm` the long-zero (or alias) EVM address. */
export type Token = {
  id: string;
  evm: Address;
  symbol: string;
  name: string;
  decimals: number;
  /** Native HBAR (id 0.0.0). Quoted through WHBAR on AMMs; paid as msg.value on chain. */
  native?: boolean;
};

export type VenueStatus = {
  ok: boolean;
  /** Human-readable reason when `ok` is false (book halted, no pair, not configured, ...). */
  reason?: string;
};

/** One executable price from one venue. All amounts in the token's smallest unit. */
export type Quote = {
  venue: VenueName;
  /** V1: token addresses; V2: packed `token|fee|token...` bytes. */
  path?: Address[] | Hex;
  /** V2 only: fee tier per hop (500 | 1500 | 3000 | 10000). */
  fees?: number[];
  /** V3 only: order book ID and side relative to the book's base token. */
  bookId?: string;
  side?: "BUY" | "SELL";
  /** Lambdaplex only: exchange symbol such as `HBAR-USDC`. */
  symbol?: string;
  amountIn: bigint;
  amountOut: bigint;
  /** V2 quoter / Lambdaplex fee quote may report this; undefined otherwise. */
  gasEstimate?: bigint;
  /** Whether the venue can fill the full `amountIn` right now. */
  fillable: boolean;
  /** Whether `amountIn` clears the venue's minimum notional (always true on AMMs). */
  minNotionalOk: boolean;
  /** Unix ms when the quote was fetched. */
  fetchedAt: number;
  /** Fee charged by the venue for this fill in `amountOut` units, already deducted from `amountOut`. */
  feeOut?: bigint;
  /** V3: amount snapped to the book's size grid; order must be built with this value. */
  snappedInputAmount?: bigint;
  /** Venue-specific detail surfaced to the UI (book flags, depth, VWAP). */
  detail?: Record<string, string | number | boolean>;
};

/** A quote-shaped entry for a venue that could not quote (so the UI can show why). */
export type VenueReport = {
  venue: VenueName;
  status: VenueStatus;
  quotes: Quote[];
  /** Milliseconds the adapter took. */
  latencyMs: number;
};

export type OnchainVenue = 0 | 1; // 0 = SaucerSwap V1, 1 = SaucerSwap V2 (matches RouterExecutor.Leg.venue)

export type RouteLeg = {
  venue: OnchainVenue;
  path: Address[] | Hex;
  amountIn: bigint;
  /** Expected output at quote time. */
  amountOut: bigint;
  /** Revert floor for this leg after slippage. */
  minOut: bigint;
};

export type PlanKind = "ONCHAIN_SPLIT" | "V3_MARKET" | "LAMBDAPLEX_MARKET";

export type ExecutionPlan = {
  kind: PlanKind;
  network: Network;
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  /** Sum of expected outputs across legs (or the single order's expected output). */
  totalOut: bigint;
  /** Revert floor for the whole plan after slippage. */
  totalMinOut: bigint;
  slippageBps: number;
  /** ONCHAIN_SPLIT only. */
  legs?: RouteLeg[];
  /** V3_MARKET / LAMBDAPLEX_MARKET only: the winning off-chain quote. */
  order?: Quote;
  /** Best single-venue quote considered (what the plan must beat or equal). */
  bestSingleVenue: Quote;
  /** Every quote considered, best first. */
  alternatives: Quote[];
  /** keccak256 of the canonical plan JSON; emitted on chain and in the HCS receipt. */
  planHash: Hex;
  createdAt: number;
};

export type ExecutionResult = {
  kind: PlanKind;
  planHash: Hex;
  /** EVM tx hashes (on-chain) or Hedera transaction IDs (V3 / Lambdaplex settlement). */
  txHashes: string[];
  filledIn: bigint;
  filledOut: bigint;
  /** Venue-specific identifiers (order IDs, settlement IDs). */
  refs?: Record<string, string>;
};
