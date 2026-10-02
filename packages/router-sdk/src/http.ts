/** Small fetch wrapper: JSON, timeout, one retry with backoff. Used by every off-chain adapter. */

export type HttpOptions = {
  method?: "GET" | "POST" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Number of retries after the first attempt (default 1). */
  retries?: number;
  /** Base backoff in ms (default 300, doubles per retry). */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

export const DEFAULT_TIMEOUT_MS = 5_000;

export async function fetchJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1, backoffMs = 300 } = opts;
  const f = opts.fetchImpl ?? fetch;
  let attempt = 0;
  for (;;) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await f(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new HttpError(res.status, url, text);
        // 4xx (other than 429) is final; retrying would not change the answer.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw err;
        throw Object.assign(err, { retryable: true });
      }
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (e) {
      const retryable =
        (e as { retryable?: boolean }).retryable || (e as Error).name === "AbortError" || !(e instanceof HttpError);
      if (!retryable || attempt >= retries) throw e;
      await sleep(backoffMs * 2 ** attempt);
      attempt += 1;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Tiny TTL cache so repeated quotes do not hammer rate-limited endpoints. */
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  set(key: string, value: V): V {
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }
  clear(): void {
    this.map.clear();
  }
}

/** Run `fn` with a timeout and a single retry; adapters use this around eth_call. */
export async function withRetry<T>(fn: () => Promise<T>, { retries = 1, backoffMs = 300 } = {}): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(backoffMs * 2 ** attempt);
      attempt += 1;
    }
  }
}
