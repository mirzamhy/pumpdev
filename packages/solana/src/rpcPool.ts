import { TokenBucket } from "./tokenBucket";

export interface EndpointConfig {
  url: string;
  rps: number;
  methodRps: number;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export interface PoolOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  maxRetries?: number;
  cooldownMs?: number;
  timeoutMs?: number;
  random?: () => number;
}

interface Endpoint {
  cfg: EndpointConfig;
  global: TokenBucket;
  methods: Map<string, TokenBucket>;
  strikes: number;
  cooldownUntil: number;
}

/** -32004 block not available, -32005 node behind, -32014 status not available yet, 429 rate limit. */
const RETRYABLE_RPC_CODES = new Set([-32004, -32005, -32014, 429]);

export class RpcPool {
  private readonly endpoints: Endpoint[];
  private next = 0;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly clock: () => number;
  private readonly maxRetries: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly random: () => number;

  constructor(endpoints: EndpointConfig[], opts: PoolOptions = {}) {
    if (endpoints.length === 0) throw new Error("RpcPool needs at least one endpoint");
    this.fetchFn = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.clock = opts.clock ?? Date.now;
    this.maxRetries = opts.maxRetries ?? 4;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.random = opts.random ?? Math.random;
    this.endpoints = endpoints.map((cfg) => ({
      cfg,
      global: new TokenBucket(cfg.rps, Math.max(1, cfg.rps), this.clock),
      methods: new Map(),
      strikes: 0,
      cooldownUntil: 0,
    }));
  }

  private methodBucket(ep: Endpoint, method: string): TokenBucket {
    let bucket = ep.methods.get(method);
    if (!bucket) {
      bucket = new TokenBucket(ep.cfg.methodRps, Math.max(1, ep.cfg.methodRps), this.clock);
      ep.methods.set(method, bucket);
    }
    return bucket;
  }

  /** Round-robin over endpoints that are not cooling down and have budget for this method. */
  private async acquire(method: string): Promise<Endpoint> {
    for (;;) {
      const now = this.clock();
      let wait = Number.POSITIVE_INFINITY;
      for (let i = 0; i < this.endpoints.length; i++) {
        const idx = (this.next + i) % this.endpoints.length;
        const ep = this.endpoints[idx]!;
        if (ep.cooldownUntil > now) {
          wait = Math.min(wait, ep.cooldownUntil - now);
          continue;
        }
        const mb = this.methodBucket(ep, method);
        const w = Math.max(ep.global.waitMs(), mb.waitMs());
        if (w === 0) {
          ep.global.take();
          mb.take();
          this.next = (idx + 1) % this.endpoints.length;
          return ep;
        }
        wait = Math.min(wait, w);
      }
      await this.sleep(Math.max(wait, 5));
    }
  }

  async call<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const ep = await this.acquire(method);
      try {
        const result = await this.send<T>(ep, method, params);
        ep.strikes = 0;
        return result;
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
        if (err instanceof RpcError && (err.status === 429 || err.status === 403)) {
          ep.strikes++;
          if (ep.strikes >= 2) {
            ep.cooldownUntil = this.clock() + this.cooldownMs;
            ep.strikes = 0;
          }
        }
        if (attempt < this.maxRetries) await this.sleep(500 * 2 ** attempt + Math.floor(this.random() * 250));
      }
    }
    throw lastError;
  }

  private async send<T>(ep: Endpoint, method: string, params: unknown[]): Promise<T> {
    const res = await this.fetchFn(ep.cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 429 || res.status === 403 || res.status >= 500) {
      throw new RpcError(`HTTP ${res.status} from ${method}`, true, res.status);
    }
    if (!res.ok) throw new RpcError(`HTTP ${res.status} from ${method}`, false, res.status);
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) {
      throw new RpcError(`${method}: ${body.error.message}`, RETRYABLE_RPC_CODES.has(body.error.code), undefined, body.error.code);
    }
    return body.result as T;
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof RpcError) return err.retryable;
  const name = (err as { name?: string } | null)?.name;
  return name === "TimeoutError" || name === "TypeError" || name === "AbortError";
}

export function parseEndpoints(spec: string, defaultRps: number, defaultMethodRps: number): EndpointConfig[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item) => {
      const [url, rps, methodRps] = item.split("|");
      return {
        url: url!,
        rps: rps ? Number(rps) : defaultRps,
        methodRps: methodRps ? Number(methodRps) : defaultMethodRps,
      };
    });
}
