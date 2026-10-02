import type { Quote, Token, VenueName, VenueStatus } from "../types";

/** Every venue the router quotes can also execute. Execution is wired in `execute/` per plan kind. */
export type Venue = {
  readonly name: VenueName;
  /** All executable routes for the pair, best first. `[]` when the venue has no route; never throws for "no route". */
  quoteExactInput(tokenIn: Token, tokenOut: Token, amountIn: bigint): Promise<Quote[]>;
  /** Whether this venue can fill right now (configured, book open, not halted, ...). */
  canExecute(tokenIn: Token, tokenOut: Token): Promise<VenueStatus>;
};

export type QuoteContext = {
  /** Unix ms; injectable for tests. */
  now?: () => number;
  fetchImpl?: typeof fetch;
};
