import { getAddress, type Address } from "viem";

/** HBAR has 8 decimals natively and inside the EVM (tinybar). */
export const HBAR_DECIMALS = 8;
/** The JSON-RPC relay exposes msg.value / gasPrice / balances with 18 decimals (weibar). */
export const WEIBAR_DECIMALS = 18;
/** 1 tinybar = 10^10 weibar (HIP-410). */
export const WEIBAR_PER_TINYBAR = 10n ** BigInt(WEIBAR_DECIMALS - HBAR_DECIMALS);

/** Parse a decimal string or number into the smallest unit. Rejects more fractional digits than `decimals`. */
export function parseUnits(amount: string | number, decimals: number): bigint {
  const s = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new Error(`invalid amount: ${amount}`);
  const [whole = "0", frac = ""] = s.split(".");
  if (frac.length > decimals) throw new Error(`amount ${amount} has more than ${decimals} decimals`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Format a smallest-unit amount as a decimal string without trailing zeros. */
export function formatUnits(amount: bigint, decimals: number): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const toTinybar = (hbar: string | number): bigint => parseUnits(hbar, HBAR_DECIMALS);
export const fromTinybar = (tinybar: bigint): string => formatUnits(tinybar, HBAR_DECIMALS);

/** Value to put in a JSON-RPC transaction so the contract sees `tinybar` as msg.value. */
export const tinybarToWeibar = (tinybar: bigint): bigint => tinybar * WEIBAR_PER_TINYBAR;

/** Convert a relay-reported weibar amount (balance, msg.value) back to tinybar. Truncates sub-tinybar dust. */
export const weibarToTinybar = (weibar: bigint): bigint => weibar / WEIBAR_PER_TINYBAR;

/** Basis-point helpers (bps of 10_000). */
export const BPS = 10_000n;
export const applyBps = (amount: bigint, bps: number): bigint => (amount * BigInt(bps)) / BPS;
/** `amount` reduced by `bps` (used for slippage floors). */
export const minusBps = (amount: bigint, bps: number): bigint => amount - applyBps(amount, bps);

const ENTITY_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** `0.0.123` → long-zero EVM address `0x000...07b`. Shard and realm must be 0. */
export function entityToAddress(id: string): Address {
  const m = ENTITY_RE.exec(id);
  if (!m) throw new Error(`invalid Hedera entity id: ${id}`);
  if (m[1] !== "0" || m[2] !== "0") throw new Error(`only shard 0 / realm 0 supported: ${id}`);
  return getAddress(`0x${BigInt(m[3]!).toString(16).padStart(40, "0")}`);
}

/** Long-zero address → `0.0.n`. Throws for alias (non long-zero) addresses. */
export function addressToEntity(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40 || !/^[0-9a-f]+$/.test(hex)) throw new Error(`invalid address: ${address}`);
  if (!hex.startsWith("0".repeat(24))) throw new Error(`not a long-zero address: ${address}`);
  return `0.0.${BigInt(`0x${hex}`)}`;
}

export const isLongZero = (address: string): boolean =>
  /^0x0{24}[0-9a-fA-F]{16}$/.test(address) && address.length === 42;
