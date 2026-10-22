import { SqliteStore } from "@pumpfun/db";
const db = new SqliteStore("./pumpfun.db").db;
const since = Math.floor(Date.now() / 1000) - 3600;
const rows = db.prepare(`SELECT m.ok, f.uri, m.twitter_kind, m.website_key, m.image_key FROM token_meta m JOIN feed_tokens f ON f.mint = m.mint WHERE m.fetched_at > ?`).all(since) as { ok: number; uri: string; twitter_kind: string | null; website_key: string | null; image_key: string | null }[];
const byHost = new Map<string, [number, number]>();
for (const r of rows) { const h = new URL(r.uri).host; const v = byHost.get(h) ?? [0, 0]; v[r.ok ? 0 : 1]++; byHost.set(h, v); }
console.log("rows", rows.length, "ok", rows.filter((r) => r.ok).length);
console.log([...byHost].sort((a, b) => b[1][0] + b[1][1] - a[1][0] - a[1][1]).slice(0, 10).map(([h, [ok, bad]]) => `${h} ok=${ok} fail=${bad}`).join("\n"));
const kinds = new Map<string, number>(); for (const r of rows.filter((r) => r.ok)) kinds.set(r.twitter_kind ?? "none", (kinds.get(r.twitter_kind ?? "none") ?? 0) + 1);
console.log("twitter kinds", Object.fromEntries(kinds));
const recycled = db.prepare(`SELECT COUNT(*) AS n FROM token_meta me WHERE me.ok = 1 AND me.fetched_at > ? AND EXISTS (SELECT 1 FROM token_meta o WHERE o.mint != me.mint AND o.ok = 1 AND o.created_at <= me.created_at - 3600 AND ((me.twitter_kind='account' AND o.twitter_kind='account' AND o.twitter_handle=me.twitter_handle) OR o.website_key=me.website_key OR o.image_key=me.image_key))`).get(since) as { n: number };
console.log("recycled", recycled.n);
