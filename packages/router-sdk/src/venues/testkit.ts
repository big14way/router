import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { getConfig } from "../config";
import { v1FactoryAbi, v1RouterAbi, v2FactoryAbi, v2QuoterAbi } from "./abi";

/** Shared fakes for adapter tests: an eth_call stub keyed by function, and a fetch stub keyed by URL. */
export const cfg = getConfig("testnet");
export const WHBAR = cfg.tokens.WHBAR!;
export const SAUCE = cfg.tokens.SAUCE!;
export const USDC = cfg.tokens.USDC!;
export const HBAR = cfg.tokens.HBAR!;

export type CallHandler = (to: Address, fn: string, args: readonly unknown[]) => Hex | undefined;

/** A viem PublicClient stub that routes `call` through `handler`; returns revert when handler yields undefined. */
export function fakeClient(handler: CallHandler): PublicClient {
  const abis = [v1FactoryAbi, v1RouterAbi, v2FactoryAbi, v2QuoterAbi];
  return {
    async call({ to, data }: { to: Address; data: Hex }) {
      for (const abi of abis) {
        try {
          const d = decodeFunctionData({ abi, data });
          const res = handler(to, d.functionName, d.args ?? []);
          if (res === undefined) throw new Error("execution reverted");
          return { data: res };
        } catch (e) {
          if ((e as Error).message === "execution reverted") throw e;
        }
      }
      throw new Error(`unhandled call to ${to}`);
    },
  } as unknown as PublicClient;
}

export const addr = (n: number): Address => `0x${n.toString(16).padStart(40, "0")}` as Address;

export const encAddress = (a: Address): Hex => encodeAbiParameters([{ type: "address" }], [a]);
export const encAmounts = (amounts: bigint[]): Hex =>
  encodeFunctionResult({ abi: v1RouterAbi, functionName: "getAmountsOut", result: amounts });
export const encQuote = (amountOut: bigint, gas = 90_000n): Hex =>
  encodeFunctionResult({ abi: v2QuoterAbi, functionName: "quoteExactInput", result: [amountOut, [0n], [1], gas] });

export type Route = { status?: number; body: unknown };

/** fetch stub: `routes` maps a URL substring to a JSON body; unmatched URLs 404. Records every URL hit. */
export function fakeFetch(routes: Record<string, Route | ((url: string, init?: RequestInit) => Route)>) {
  const calls: string[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const key = Object.keys(routes).find(k => url.includes(k));
    const r = key ? routes[key]! : undefined;
    const route = typeof r === "function" ? r(url, init) : r;
    const status = route?.status ?? (route ? 200 : 404);
    const body = route ? JSON.stringify(route.body) : JSON.stringify({ error: "not found" });
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return Object.assign(f, { calls });
}

export const mirror404: typeof fetch = async () => new Response("{}", { status: 404 });
