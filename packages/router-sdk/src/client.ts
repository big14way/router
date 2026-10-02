/**
 * Browser-safe entry: types, units, config, token helpers and the pure ranking logic.
 * No Node built-ins, no HTTP adapters, no signing — import this from client components.
 */
export * from "./types";
export * from "./units";
export * from "./config";
export * from "./tokens";
export { rankQuotes, routeKey, isAmm, byOutDesc, type Ranking, type Excluded } from "./router/rank";
export { encodeLegPath, LEG_ABI, onchainPlanHash, offchainPlanHash, DEFAULT_SLIPPAGE_BPS } from "./router/plan";
