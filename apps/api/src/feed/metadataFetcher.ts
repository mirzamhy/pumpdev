import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { IPFS_GATEWAYS, ipfsPath, type MetadataSource } from "@pumpfun/core";

/**
 * Token creators choose the metadata URL, so every fetch is treated as hostile: only public addresses,
 * default ports, a couple of redirects, a small body and a short timeout.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(ip: string): boolean {
  const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]!);
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, "ipv4");
  if (family === 6) return !blocked.check(ip, "ipv6");
  return false;
}

/** Candidate URLs for a metadata `uri`, IPFS links moved onto gateways that still serve API requests. */
export function gatewayUrls(uri: string): string[] {
  const path = ipfsPath(uri);
  if (path) return IPFS_GATEWAYS.map((g) => `${g}${path}`);
  try {
    const u = new URL(uri.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? [u.toString()] : [];
  } catch {
    return [];
  }
}

export interface MetadataFetcherOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  /** Tests allow loopback; production keeps the default. */
  allowAddress: (ip: string) => boolean;
  allowAnyPort: boolean;
}

const DEFAULTS: MetadataFetcherOptions = {
  timeoutMs: 5000,
  maxBytes: 64 * 1024,
  maxRedirects: 2,
  allowAddress: isPublicAddress,
  allowAnyPort: false,
};

export class MetadataFetcher implements MetadataSource {
  private readonly opts: MetadataFetcherOptions;
  private readonly lookup: LookupFunction;

  constructor(opts: Partial<MetadataFetcherOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    const allow = this.opts.allowAddress;
    // Checked at connect time, on the address actually used, so DNS rebinding cannot slip a private IP in.
    this.lookup = (hostname, options, callback) => {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
        if (err) return callback(err, "", 4);
        const ok = addresses.filter((a) => allow(a.address));
        if (ok.length === 0) return callback(new Error(`blocked address for ${hostname}`), "", 4);
        if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, ok);
        callback(null, ok[0]!.address, ok[0]!.family);
      });
    };
  }

  async fetch(uri: string): Promise<unknown | null> {
    for (const url of gatewayUrls(uri)) {
      const json = await this.get(url, this.opts.maxRedirects).catch(() => null);
      if (json !== null) return json;
    }
    return null;
  }

  private get(raw: string, redirectsLeft: number): Promise<unknown | null> {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return Promise.resolve(null);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return Promise.resolve(null);
    if (url.port && !this.opts.allowAnyPort) return Promise.resolve(null);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !this.opts.allowAddress(host)) return Promise.resolve(null);

    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((resolve) => {
      let settled = false;
      const done = (value: unknown | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.destroy();
        resolve(value);
      };
      const timer = setTimeout(() => done(null), this.opts.timeoutMs);
      const req = request(url, { method: "GET", lookup: this.lookup, headers: { accept: "application/json", "user-agent": "pumpfun.dev metadata" } }, (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return done(null);
          const next = new URL(res.headers.location, url).toString();
          settled = true;
          clearTimeout(timer);
          resolve(this.get(next, redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          return done(null);
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > this.opts.maxBytes) return done(null);
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const json: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            done(json && typeof json === "object" && !Array.isArray(json) ? json : null);
          } catch {
            done(null);
          }
        });
        res.on("error", () => done(null));
      });
      req.on("error", () => done(null));
      req.end();
    });
  }
}
