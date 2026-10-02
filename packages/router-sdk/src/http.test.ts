import { describe, expect, it } from "vitest";
import { fetchJson, HttpError, TtlCache, withRetry } from "./http";

const respond = (bodies: Array<{ status: number; body: string } | "hang">) => {
  let i = 0;
  const calls: number[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    const b = bodies[Math.min(i, bodies.length - 1)]!;
    calls.push(i);
    i += 1;
    if (b === "hang") {
      return new Promise<Response>((_, rej) =>
        init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))),
      );
    }
    return new Response(b.body, { status: b.status });
  }) as typeof fetch;
  return Object.assign(f, { calls });
};

describe("fetchJson", () => {
  it("parses JSON and retries 5xx once", async () => {
    const f = respond([
      { status: 503, body: "down" },
      { status: 200, body: '{"ok":1}' },
    ]);
    expect(await fetchJson<{ ok: number }>("http://x", { fetchImpl: f, backoffMs: 1 })).toEqual({ ok: 1 });
    expect(f.calls).toHaveLength(2);
  });

  it("does not retry 4xx and exposes status/body", async () => {
    const f = respond([{ status: 400, body: '{"error":"bad"}' }]);
    await expect(fetchJson("http://x", { fetchImpl: f, backoffMs: 1 })).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(1);
    const e = (await fetchJson("http://x", { fetchImpl: f }).catch(x => x)) as HttpError;
    expect(e).toBeInstanceOf(HttpError);
    expect(e.message).toContain("HTTP 400");
  });

  it("retries 429 and times out hung requests", async () => {
    const f = respond([
      { status: 429, body: "slow down" },
      { status: 429, body: "slow down" },
    ]);
    await expect(fetchJson("http://x", { fetchImpl: f, backoffMs: 1 })).rejects.toMatchObject({ status: 429 });
    expect(f.calls).toHaveLength(2);
    const hang = respond(["hang"]);
    await expect(fetchJson("http://x", { fetchImpl: hang, timeoutMs: 10, retries: 0 })).rejects.toThrow(/aborted/);
    const empty = respond([{ status: 200, body: "" }]);
    expect(await fetchJson("http://x", { fetchImpl: empty })).toBeUndefined();
  });

  it("sends JSON bodies with content-type", async () => {
    let seen: RequestInit | undefined;
    const f = (async (_u: string | URL | Request, init?: RequestInit) => {
      seen = init;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await fetchJson("http://x", { method: "POST", body: { a: 1 }, fetchImpl: f });
    expect(seen?.method).toBe("POST");
    expect(seen?.body).toBe('{"a":1}');
    expect((seen?.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });
});

describe("TtlCache / withRetry", () => {
  it("expires entries", async () => {
    const c = new TtlCache<number>(5);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    await new Promise(r => setTimeout(r, 10));
    expect(c.get("a")).toBeUndefined();
    c.set("b", 2);
    c.clear();
    expect(c.get("b")).toBeUndefined();
  });

  it("retries once then rethrows", async () => {
    let n = 0;
    expect(
      await withRetry(
        async () => {
          n += 1;
          if (n < 2) throw new Error("x");
          return n;
        },
        { backoffMs: 1 },
      ),
    ).toBe(2);
    await expect(
      withRetry(
        async () => {
          throw new Error("always");
        },
        { backoffMs: 1 },
      ),
    ).rejects.toThrow("always");
  });
});
