# pumpfun.dev — Sub-project 3: Live Screener

Tanggal: 2026-10-21
Status: disetujui user (desain di chat), siap direncanakan

## 1. Tujuan

Halaman `/screener` yang menampilkan semua token pump.fun baru secara live, dengan:

- umur, market cap (SOL), progres bonding curve, dev, flag (copycat, mayhem, migrated),
- skor risiko untuk token yang sudah di-trace,
- auto-trace untuk token yang "mulai ramai", supaya skor sudah siap sebelum user klik.

Keputusan user: sumber token baru = PumpPortal websocket; auto-trace hanya token yang mulai ramai, token lain di-trace saat diklik.

## 2. Fakta yang diverifikasi live (2026-10-21)

- `wss://pumpportal.fun/api/data`, `{"method":"subscribeNewToken"}` dan `{"method":"subscribeMigration"}` gratis tanpa API key. Balasan pertama berupa `{"message": "..."}` (konfirmasi), bukan event.
- `subscribeTokenTrade` / `subscribeAccountTrade` butuh API key bersaldo ≥ 0,02 SOL → **tidak dipakai**.
- Laju: ±1 token baru per detik, ±18 KB per 30 detik.
- Event create (pool `pump`): `signature, mint, traderPublicKey, txType:"create", initialBuy, solAmount, bondingCurveKey, vTokensInBondingCurve, vSolInBondingCurve, marketCapSol, name, symbol, uri, is_mayhem_mode, pool`.
- Stream yang sama juga membawa token **letsbonk** (`pool:"bonk"`, `bondingCurveKey: null`, field berbeda) → diabaikan, hanya `pool === "pump"`.
- Event migrasi: `{signature, mint, txType:"migrate", pool:"pump-amm"}`.
- Akun Global pump (`4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf`): `initial_virtual_token_reserves` 1.073.000.000, `initial_virtual_sol_reserves` 30 SOL, `initial_real_token_reserves` 793.100.000, supply 1.000.000.000 (6 desimal).
- Akun bonding curve: `virtual_token_reserves` (off 8), `virtual_quote_reserves` (16), `real_token_reserves` (24), `real_quote_reserves` (32), `token_total_supply` (40), `complete` (48). `vt - rt` selalu 279.900.000 token (normal dan mayhem).
- Curve yang sudah selesai berisi reserve 0 semua (ada token yang menghabiskan curve di tx create).
- Koin mayhem: `virtual_quote_reserves` tidak mengikuti kurva normal (real SOL jauh lebih kecil). Karena itu ukuran "ramai" memakai **progres token**, bukan SOL.
- `getMultipleAccounts` (100 akun per request) untuk curve token baru berjalan lancar di RPC publik.

## 3. Rumus

- `progressPct = (1 − real_token_reserves / 793.100.000e6) × 100`, dibatasi 0–100; `complete` → 100.
- `marketCapSol = virtual_quote / virtual_token × token_total_supply / 1e9` (lamports dan raw token sama-sama dibagi). Curve dengan reserve 0 → `null`.
- `realSol = real_quote_reserves / 1e9`.

## 4. Arsitektur

```
PumpPortal WS ──► PumpPortalClient ──► FeedService ──► SqliteStore.feed_tokens
                    (reconnect)          │   ▲
                                         │   └── poll curve (getAccounts) tiap 20 s / 120 s
                                         └──► JobManager.start(mint, "auto")  (budget/jam)
Web /screener ──► GET /api/feed (poll 4 s) ──► store.feed(...) + status job
```

### 4.1 `packages/core`

- `decodeBondingCurve` juga mengembalikan `virtualTokenReserves`, `virtualQuoteReserves`, `realTokenReserves`, `tokenTotalSupply`.
- `curveMetrics(state)` → `{ marketCapSol: number | null, progressPct: number, realSol: number, complete }`.
- Konstanta `INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n`.

### 4.2 `packages/shared`

- `FeedTab = "new" | "hot" | "traced"`.
- `FeedItem { mint, name, symbol, creator, createdAt, marketCapSol, progressPct, realSol, initialBuySol, complete, migratedAt, isMayhemMode, copycatCount, autoTraced, trace: { state: "none"|"queued"|"running"|"done", score, level } }`.
- `FeedResponse { items: FeedItem[], stats: { seenLastHour, tracedLastHour, highRiskShare: number|null, connected } }`.

### 4.3 `packages/db`

Tabel baru `feed_tokens`:

| kolom | isi |
|---|---|
| mint PK | |
| name, symbol, uri | dari event |
| symbol_key | `lower(trim(symbol))` untuk copycat, ber-index |
| creator | `traderPublicKey` |
| bonding_curve | dari event, atau PDA kalau kosong |
| create_signature | |
| created_at | detik (waktu event diterima) |
| initial_buy_sol | `solAmount` |
| mayhem | 0/1 |
| market_cap_sol, progress_pct, real_sol | REAL, diisi dari event lalu dari curve |
| complete | 0/1 |
| migrated_at | dari event migrasi |
| auto_traced_at | waktu auto-trace dimasukkan antrean |
| polled_at | |

Metode store: `insertFeedToken`, `updateFeedCurves`, `markMigrated`, `markAutoTraced`, `feedTokensToPoll(now)`, `feed({tab, hideHigh, limit, now})`, `feedStats(now)`, `pruneFeed(before)`.

- `findCreateSignature(mint)` juga melihat `feed_tokens.create_signature`, jadi trace token dari screener tidak perlu menyusuri riwayat curve.
- `copycatCount` = jumlah token lain dengan `symbol_key` sama dalam 24 jam terakhir.

### 4.4 `apps/api/src/feed/`

- `pumpPortal.ts` — `PumpPortalClient`: memakai `WebSocket` bawaan Node 24 (tanpa dependency). Subscribe new token + migration saat terbuka. Reconnect dengan backoff 1 s → 30 s (reset setelah 60 s tersambung). Watchdog: kalau 60 s tanpa pesan, tutup dan sambung ulang. Event diparse dan divalidasi ringan (`parseCreate`, `parseMigrate`), pesan lain diabaikan. Factory WebSocket bisa diganti untuk tes.
- `feedService.ts` — `FeedService`:
  - `onCreate`: simpan ke `feed_tokens` (abaikan duplikat).
  - `onMigrate`: tandai migrated + complete.
  - `tick()` tiap `FEED_POLL_SEC` (20 s): ambil token yang perlu dibaca — umur < 10 menit (tiap tick) atau progres ≥ 10 % dan umur < 6 jam, belum complete (tiap 120 s) — baca curve per 100 via `chain.getAccounts`, update metrik.
  - Auto-trace: token dengan umur ≤ `AUTO_TRACE_WINDOW_SEC` (900), progres ≥ `AUTO_TRACE_MIN_PROGRESS` (40 %, ±12 SOL di kurva normal), belum pernah auto-trace, belum punya hasil trace < 1 jam. Budget token-bucket `AUTO_TRACE_PER_HOUR` (20). Kandidat diurutkan dari progres tertinggi.
  - Prune baris > `FEED_RETENTION_HOURS` (24) sekali per 10 menit.
  - Error RPC di tick dicatat, tick berikutnya jalan normal.
- `FEED_ENABLED=false` mematikan semuanya (tes, smoke).

### 4.5 `JobManager` — prioritas

- `start(mint, priority = "user")`. Dua antrean: `user` dan `auto`.
- Slot dipakai dari antrean user dulu. Job auto maksimal **1 berjalan** bersamaan, jadi trace user selalu dapat slot.
- Kalau user meminta mint yang sedang antre auto, job dipindah ke antrean user (id sama).
- `stateOf(mint)` → `"queued" | "running" | null`.

### 4.6 API

- `GET /api/feed?tab=new|hot|traced&hideHigh=0|1&limit=1..200` → `FeedResponse`.
  - `new`: urut `created_at` desc.
  - `hot`: belum migrasi, umur < 6 jam, urut `progress_pct` desc.
  - `traced`: punya hasil trace, urut waktu selesai trace desc.
  - `hideHigh`: buang yang skornya level high.
- Tanpa SSE: frontend polling 4 detik (query SQLite murah, lebih sederhana dan tahan putus).

### 4.7 Frontend `/screener`

- Link "Screener" di header; CTA di home.
- Tab New / Hot / Traced, toggle "Hide high risk", strip statistik (token baru/jam, di-trace/jam, % high risk di antara yang di-trace, status koneksi).
- Desktop: tabel (token + simbol, umur relatif, mcap, bar progres, dev pendek, flag, skor). Mobile (< 768 px): daftar kartu.
- Badge skor dengan warna level; "queued"/"tracing…" berdenyut; "–" kalau belum di-trace.
- Klik baris → `/token/$mint` (trace mulai otomatis seperti biasa).
- Umur diperbarui tiap detik di klien.

## 5. Penanganan error

- WS putus: status `connected: false` tampil di strip; reconnect otomatis.
- Curve null (belum tersedia di commitment confirmed): dicoba di tick berikutnya.
- Budget auto-trace habis: kandidat menunggu tick berikutnya selama masih dalam window.

## 6. Tes

- core: `curveMetrics` (normal, complete/nol, mayhem), decoder field baru.
- db: insert/dupe, poll set, feed per tab, copycat, hideHigh, stats, prune, `findCreateSignature` fallback.
- api: parser PumpPortal (create pump, bonk diabaikan, migrate, pesan konfirmasi), client reconnect dengan fake WebSocket, FeedService tick + auto-trace budget dengan FakeChain, JobManager prioritas, route `/api/feed`.
- web: Playwright screener (fixture feed, tab, klik ke token).
- Live: jalankan API ±5 menit di mainnet, cek feed terisi, metrik cocok dengan `marketCapSol` event, auto-trace berjalan.

## 7. Di luar cakupan

Cek sosmed/metadata daur ulang, profil kebiasaan dev, hall of shame (sub-project 3.5); alert Telegram, pantau dev live, kartu share (sub-project 4).
