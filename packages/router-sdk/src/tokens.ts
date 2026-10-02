import { getAddress } from "viem";
import type { NetworkConfig } from "./config";
import type { Token } from "./types";
import { entityToAddress } from "./units";

const ENTITY_RE = /^\d+\.\d+\.\d+$/;

/** Resolve a symbol (`SAUCE`), entity ID (`0.0.1183558`) or EVM address to a configured token. */
export function resolveToken(cfg: NetworkConfig, ref: string): Token {
  const key = ref.trim();
  const list = Object.values(cfg.tokens);
  const bySymbol = list.find(t => t.symbol.toLowerCase() === key.toLowerCase());
  if (bySymbol) return bySymbol;
  if (ENTITY_RE.test(key)) {
    const byId = list.find(t => t.id === key);
    if (byId) return byId;
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(key)) {
    const addr = getAddress(key);
    const byAddr = list.find(t => getAddress(t.evm) === addr);
    if (byAddr) return byAddr;
  }
  throw new Error(`unknown token "${ref}" on ${cfg.network}; known: ${list.map(t => t.symbol).join(", ")}`);
}

/** Build a Token for an HTS fungible token that is not in the static config (e.g. seeded test tokens). */
export function htsToken(id: string, symbol: string, decimals: number, name = symbol): Token {
  return { id, evm: entityToAddress(id), symbol, name, decimals };
}

/** Native HBAR is routed through WHBAR on both AMMs. */
export function ammToken(cfg: NetworkConfig, token: Token): Token {
  return token.native ? cfg.tokens.WHBAR! : token;
}

export const sameToken = (a: Token, b: Token): boolean => a.id === b.id;
