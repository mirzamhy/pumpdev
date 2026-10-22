import type { TwitterLink } from "@pumpfun/shared";

export interface ParsedMetadata {
  twitter: TwitterLink | null;
  telegram: string | null;
  website: string | null;
  /** Comparable form of the website: host, or host + path on big platforms. */
  websiteKey: string | null;
  image: string | null;
  /** `ipfs:<CID>` when the image lives on IPFS (CIDs are content hashes), else the URL without query. */
  imageKey: string | null;
  description: string | null;
}

const TWITTER_HOSTS = new Set(["x.com", "twitter.com"]);
const RESERVED_PATHS = new Set(["i", "home", "search", "intent", "share", "hashtag", "explore", "settings"]);
/** Hosts where many unrelated tokens link different pages; compare the path, not just the host. */
const PLATFORM_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "t.me",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "instagram.com",
  "pump.fun",
  "dexscreener.com",
  "github.com",
  "google.com",
]);
const MAX_DESCRIPTION = 280;

/**
 * ipfs.io stopped serving API requests (always 429) in 2026; these answered every probe.
 * First entry is also the one images are shown from.
 */
export const IPFS_GATEWAYS = ["https://ipfs.filebase.io/ipfs/", "https://4everland.io/ipfs/"];

const bareHost = (host: string) => host.toLowerCase().replace(/^(www|mobile|m)\./, "");

/** Only absolute http(s) URLs survive; everything else (javascript:, data:, bare handles) is dropped. */
function httpUrl(v: unknown): URL | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function parseTwitter(v: unknown): TwitterLink | null {
  const u = httpUrl(v);
  if (!u) return null;
  const url = (v as string).trim();
  const parts = u.pathname.split("/").filter(Boolean);
  if (!TWITTER_HOSTS.has(bareHost(u.hostname)) || parts.length === 0) return { url, kind: "other", handle: null, tweetId: null };
  const first = parts[0]!.toLowerCase();
  if (first === "i" && parts[1] === "communities") return { url, kind: "community", handle: null, tweetId: null };
  if (RESERVED_PATHS.has(first)) return { url, kind: "other", handle: null, tweetId: null };
  if (parts[1] === "status" && parts[2] && /^\d+$/.test(parts[2])) return { url, kind: "tweet", handle: first, tweetId: parts[2] };
  if (parts.length === 1) return { url, kind: "account", handle: first, tweetId: null };
  return { url, kind: "other", handle: null, tweetId: null };
}

/** A path segment that looks like a Solana address: per-token pages on token-listing services. */
const ADDRESS_SEGMENT = /\/[1-9A-HJ-NP-Za-km-z]{32,44}(\/|$)/;

function websiteKey(u: URL): string {
  const host = bareHost(u.hostname);
  if (!PLATFORM_HOSTS.has(host) && !ADDRESS_SEGMENT.test(u.pathname)) return host;
  const path = u.pathname.replace(/\/+$/, "");
  return `${host}${path}`;
}

/** CID from `ipfs://CID`, `https://<gateway>/ipfs/CID/...` or subdomain gateways `https://CID.ipfs.<host>/`. */
export function ipfsCid(url: string): string | null {
  const s = url.trim();
  if (s.startsWith("ipfs://")) return s.slice(7).split(/[/?#]/)[0] || null;
  const path = s.match(/\/ipfs\/([A-Za-z0-9]{46,})/);
  if (path) return path[1]!;
  const sub = s.match(/^https?:\/\/([a-z0-9]{50,})\.ipfs\./);
  return sub ? sub[1]! : null;
}

/** Browser-loadable image URL: IPFS images go through a working gateway. */
export function displayImageUrl(image: string | null): string | null {
  if (!image) return null;
  const path = ipfsPath(image);
  return path ? `${IPFS_GATEWAYS[0]}${path}` : image;
}

/** `CID[/sub/path]` of an IPFS URL, for rewriting onto another gateway. */
export function ipfsPath(url: string): string | null {
  const s = url.trim();
  if (s.startsWith("ipfs://")) return s.slice(7) || null;
  const m = s.match(/\/ipfs\/([A-Za-z0-9]{46,}(?:\/[^?#]*)?)/);
  if (m) return m[1]!;
  const cid = ipfsCid(s);
  return cid;
}

function imageKey(raw: string, u: URL | null): string | null {
  const cid = ipfsCid(raw);
  if (cid) return `ipfs:${cid}`;
  return u ? `${u.origin}${u.pathname}` : null;
}

export function parseMetadata(json: unknown): ParsedMetadata {
  const m = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const website = httpUrl(m.website);
  const imageRaw = typeof m.image === "string" ? m.image.trim() : "";
  const imageUrl = httpUrl(imageRaw);
  const image = imageUrl || imageRaw.startsWith("ipfs://") ? imageRaw : null;
  const description = typeof m.description === "string" ? m.description.trim().slice(0, MAX_DESCRIPTION) : "";
  return {
    twitter: parseTwitter(m.twitter),
    telegram: httpUrl(m.telegram) ? (m.telegram as string).trim() : null,
    website: website ? (m.website as string).trim() : null,
    websiteKey: website ? websiteKey(website) : null,
    image,
    imageKey: image ? imageKey(image, imageUrl) : null,
    description: description || null,
  };
}
