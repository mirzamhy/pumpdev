import { base58Address } from "@pumpfun/shared";

export interface CreateEvent {
  signature: string;
  mint: string;
  /** Signer of the create transaction (`traderPublicKey`). */
  creator: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  bondingCurve: string | null;
  /** SOL the creator spent on the initial buy. */
  initialBuySol: number | null;
  marketCapSol: number | null;
  /** Virtual token reserves after the create, in whole tokens. */
  vTokens: number | null;
  isMayhemMode: boolean;
}

export interface MigrateEvent {
  signature: string;
  mint: string;
}

export type PortalEvent = { type: "create"; data: CreateEvent } | { type: "migrate"; data: MigrateEvent };

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isAddress = (v: unknown): v is string => typeof v === "string" && base58Address.safeParse(v).success;

/**
 * PumpPortal sends JSON objects: `{message}` confirmations, pump.fun creations, letsbonk creations
 * (`pool: "bonk"`, ignored) and migrations. Anything unexpected is dropped.
 */
export function parsePortalMessage(raw: string): PortalEvent | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || !isAddress(m.mint) || typeof m.signature !== "string") return null;
  if (m.txType === "migrate") return { type: "migrate", data: { signature: m.signature, mint: m.mint } };
  if (m.txType !== "create" || m.pool !== "pump" || !isAddress(m.traderPublicKey)) return null;
  return {
    type: "create",
    data: {
      signature: m.signature,
      mint: m.mint,
      creator: m.traderPublicKey,
      name: text(m.name),
      symbol: text(m.symbol),
      uri: text(m.uri),
      bondingCurve: isAddress(m.bondingCurveKey) ? m.bondingCurveKey : null,
      initialBuySol: num(m.solAmount),
      marketCapSol: num(m.marketCapSol),
      vTokens: num(m.vTokensInBondingCurve),
      isMayhemMode: m.is_mayhem_mode === true,
    },
  };
}

/** The subset of the WHATWG WebSocket the client uses; Node 24 ships one globally. */
export interface WsLike {
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface PumpPortalOptions {
  url: string;
  onEvent(e: PortalEvent): void;
  log?(message: string): void;
  createSocket?(url: string): WsLike;
  /** Reconnect when nothing arrives for this long. */
  idleMs?: number;
  maxBackoffMs?: number;
}

const BASE_BACKOFF_MS = 1000;
const STABLE_MS = 60_000;
const SUBSCRIPTIONS = [{ method: "subscribeNewToken" }, { method: "subscribeMigration" }];

export class PumpPortalClient {
  private socket: WsLike | null = null;
  private attempt = 0;
  private stopped = true;
  private open = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;

  constructor(private readonly opts: PumpPortalOptions) {}

  get connected(): boolean {
    return this.open;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.open = false;
    socket?.close();
  }

  private connect(): void {
    const create = this.opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WsLike);
    const socket = create(this.opts.url);
    this.socket = socket;
    this.touch();
    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.open = true;
      for (const s of SUBSCRIPTIONS) socket.send(JSON.stringify(s));
      this.touch();
      this.stableTimer = setTimeout(() => (this.attempt = 0), STABLE_MS);
      this.opts.log?.("PumpPortal connected");
    };
    socket.onmessage = (e) => {
      if (socket !== this.socket) return;
      this.touch();
      const event = parsePortalMessage(String(e.data));
      if (event) this.opts.onEvent(event);
    };
    socket.onerror = () => {
      // A close event always follows; reconnecting happens there.
    };
    socket.onclose = () => {
      if (socket !== this.socket) return;
      this.socket = null;
      this.open = false;
      this.clearTimers();
      if (this.stopped) return;
      const delay = Math.min(this.opts.maxBackoffMs ?? 30_000, BASE_BACKOFF_MS * 2 ** this.attempt);
      this.attempt++;
      this.opts.log?.(`PumpPortal disconnected, retrying in ${delay} ms`);
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.stopped) this.connect();
      }, delay);
    };
  }

  /** Restart the idle watchdog. */
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const socket = this.socket;
    this.idleTimer = setTimeout(() => {
      this.opts.log?.("PumpPortal idle, reconnecting");
      socket?.close();
    }, this.opts.idleMs ?? 60_000);
  }

  private clearTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.idleTimer = null;
    this.stableTimer = null;
  }
}
