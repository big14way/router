/** Client-side formatting helpers (no SDK runtime import so the browser bundle stays lean). */
export function fmtUnits(amount: string | bigint | undefined, decimals: number, maxFrac = 6): string {
  if (amount === undefined) return "–";
  const v = BigInt(amount);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = (abs / base).toLocaleString("en-US");
  let frac = (abs % base).toString().padStart(decimals, "0").slice(0, Math.min(decimals, maxFrac)).replace(/0+$/, "");
  if (frac === "" && abs % base !== 0n && maxFrac > 0) frac = "0".repeat(maxFrac);
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "–");

export const VENUE_LABEL: Record<string, string> = {
  SAUCER_V1: "SaucerSwap V1",
  SAUCER_V2: "SaucerSwap V2",
  SAUCER_V3: "SaucerSwap V3 book",
  LAMBDAPLEX: "Lambdaplex",
};

export const KIND_LABEL: Record<string, string> = {
  ONCHAIN_SPLIT: "On-chain (RouterExecutor)",
  V3_MARKET: "SaucerSwap V3 market order",
};
