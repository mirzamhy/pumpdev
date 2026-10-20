# pumpfun.dev — Sub-project 1: Trace Engine + Halaman Token

Tanggal: 2026-10-20
Status: draft, menunggu review user

## 1. Tujuan

Website screening token pump.fun di domain `pumpfun.dev`. User memasukkan contract address (CA). Sistem menampilkan:

- siapa deployer token (wallet yang menandatangani transaksi create),
- rantai pendana deployer: dari mana SOL pertama deployer berasal, lalu dari mana SOL pertama wallet itu berasal, dan seterusnya,
- token lain yang pernah dibuat deployer dan nasibnya,
- apakah dev masih pegang, sudah jual, atau memindahkan token ke wallet lain,
- wallet di rantai yang juga muncul di trace token lain (cross-link),
- risk score 0–100 dengan alasan yang bisa dibaca orang awam.

Proyek keseluruhan dipecah jadi beberapa sub-project. Dokumen ini hanya sub-project 1.

| # | Sub-project | Isi |
|---|---|---|
| 1 | Trace engine + halaman token | dokumen ini |
| 2 | Bundle detector + bubble map | pembeli blok awal, top holder, cluster berdasarkan funder sama, insider supply %, fresh wallet holder, sniper berulang |
| 3 | Screener | feed coin baru live, sort/filter berdasarkan risk score, socials/metadata recycle, coin tiruan |
| 4 | Lanjutan | watchlist + alert Telegram, deteksi wash trading, laporan komunitas |

Sub-project 2 dan 3 memakai ulang trace engine dan database dari sub-project 1, jadi arsitektur di sini sudah disiapkan untuk mereka.

## 2. Batasan dan keputusan

- **Data hanya dari RPC Solana gratis.** Tidak ada API berbayar. Daftar endpoint RPC bisa diatur lewat env. Default: `https://api.mainnet.solana.com`. Operator boleh menambah endpoint gratis lain (misal key free tier yang didaftar sendiri) untuk menambah kapasitas.
- **Hosting: satu VPS** (Linux) dengan Docker Compose + Caddy.
- **Aturan trace:** satu funder per wallet, yaitu pengirim transfer SOL masuk pertama. Maksimal 5 hop.
- **Tanpa daftar label CEX.** Diganti heuristik "wallet aktivitas tinggi".
- **Bahasa UI:** v1 Bahasa Inggris saja, karena audiens memecoin global. Multi-bahasa (termasuk Indonesia) di luar cakupan v1.

## 3. Fakta teknis yang sudah diverifikasi

Diambil dari IDL resmi `pump-fun/pump-public-docs` (idl/pump.json, idl/pump_amm.json) dan dokumentasi Solana, dicek 2026-10-20.

- Program pump.fun (bonding curve): `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`.
- Program PumpSwap (AMM setelah token lulus/migrasi): `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`.
- PDA bonding curve: seeds `["bonding-curve", mint]`.
- Field akun `BondingCurve` berurutan: `virtual_token_reserves u64, virtual_quote_reserves u64, real_token_reserves u64, real_quote_reserves u64, token_total_supply u64, complete bool, creator pubkey, is_mayhem_mode bool, is_cashback_coin bool, quote_mint pubkey, ...`. Jadi `creator` ada di offset 49 (8 byte discriminator + 5×8 + 1).
- Ada dua instruksi pembuatan token: `create` (SPL Token + Metaplex) dan `create_v2` (Token-2022, punya opsi mayhem mode). Keduanya harus didukung.
- `creator` di akun bonding curve **bisa berubah** (`set_creator`, `admin_cto` untuk community takeover). Jadi `creator` sekarang belum tentu orang yang deploy. Yang deploy adalah akun `user` (signer) di transaksi create. Event `CreateEvent` memuat `user` dan `creator`, beserta `timestamp`, `name`, `symbol`, `token_program`, `is_mayhem_mode`, `quote_mint`.
- Ada banyak varian instruksi beli/jual (`buy`, `buy_v2`, `buy_v3`, `buy_exact_sol_in`, `sell`, `sell_v2`, `sell_v3`, `multi_hop_curve_swap`, dll). Semuanya memancarkan `TradeEvent` (`mint, sol_amount, token_amount, is_buy, user, timestamp, ...`). Karena itu parser membaca **event**, bukan nama instruksi.
- Token bisa dipasangkan dengan quote selain SOL (`quote_mint`). UI menampilkan quote-nya.
- Mayhem mode: agen AI pump.fun ikut trading di 24 jam pertama. Volume awal token ini tidak murni organik. Ditampilkan sebagai badge informasi, bukan faktor risiko.
- Batas RPC publik mainnet per IP: 100 request / 10 detik total, **40 request / 10 detik per method**, 40 koneksi bersamaan, 100 MB / 30 detik. Batas per method inilah yang paling mengikat: `getTransaction` maksimal ±4 per detik.
- `getSignaturesForAddress` maksimal 1.000 signature per halaman, paginasi pakai `before`.
- SDK: `@solana/kit` adalah SDK TypeScript yang direkomendasikan resmi; `@solana/web3.js` sudah legacy.

## 4. Arsitektur

Monorepo pnpm, semua TypeScript.

```
pumpfun.dev/
  apps/web        SPA frontend
  apps/api        HTTP API + SSE + worker trace (satu proses)
  packages/core   logika trace & scoring (murni, tanpa I/O langsung)
  packages/solana klien RPC: pool endpoint, rate limiter, retry, decoder event pump.fun
  packages/db     schema Drizzle + query
  packages/shared schema Zod + tipe yang dipakai web dan api
```

**Batas antar unit:**

- `packages/core` menerima sebuah interface `ChainSource` (misal `getSignatures`, `getTransaction`, `getAccounts`, `getTokenAccountsByOwner`) dan interface `Store` (baca/tulis cache). Tidak tahu soal HTTP, SQLite, atau RPC. Bisa dites penuh dengan data rekaman.
- `packages/solana` mengimplementasi `ChainSource` di atas `@solana/kit`.
- `packages/db` mengimplementasi `Store` di atas SQLite.
- `apps/api` merangkai ketiganya, mengatur antrean job, dan menyiarkan event.

**Stack (versi stabil terbaru saat instalasi, di-pin di lockfile):**

- Frontend: React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui, TanStack Router, TanStack Query, React Flow (`@xyflow/react`), Motion.
- Backend: Node 24 LTS, Fastify 5, Zod, `@solana/kit`.
- DB: SQLite (better-sqlite3, mode WAL) + Drizzle ORM.
- Test: Vitest, Playwright.
- Deploy: Docker Compose (service `api`) + Caddy (HTTPS otomatis, sajikan build statis `apps/web`, reverse proxy `/api/*`).

## 5. Klien RPC (`packages/solana`)

- **Pool endpoint** dari env `RPC_URLS` (dipisah koma). Request dibagi round-robin. Endpoint yang mengembalikan 429/403 berulang kali didinginkan sementara (cooldown 30 detik).
- **Rate limiter** per endpoint: token bucket global (default 8 req/detik) dan bucket per method (default 3,5 req/detik). Angka bisa diatur per endpoint di env, karena endpoint free tier lain punya batas berbeda.
- **Retry:** 429, 5xx, dan timeout diulang dengan exponential backoff + jitter, maksimal 4 kali.
- **Decoder event pump.fun:** event Anchor dipancarkan lewat self-CPI ke `event_authority`. Decoder membaca inner instruction ke program pump.fun, melepas prefix event, mencocokkan discriminator dari IDL, lalu men-decode `CreateEvent` dan `TradeEvent` (Borsh). Discriminator dan layout diambil dari file IDL resmi yang disalin ke repo (bukan ditulis tangan).

## 6. Alur trace

Input: CA (base58). Validasi: alamat valid, dan akun bonding curve PDA-nya ada. Kalau tidak ada, kembalikan error "bukan token pump.fun".

### 6.1 Cari transaksi create dan deployer

1. Ambil akun bonding curve (1 request). Dapat: `creator` sekarang, `complete`, `quote_mint`, `is_mayhem_mode`, reserve.
2. **Jalur cepat:** paginasi signature milik `creator` (maksimal 3 halaman), cari transaksi yang menyentuh mint ini dan memuat `CreateEvent` untuk mint ini. Wallet dev biasanya transaksinya sedikit, jadi ini murah.
3. **Fallback** (creator sudah diganti, atau jalur cepat gagal): paginasi signature milik mint sampai yang tertua, maksimal 20 halaman. Transaksi tertua adalah transaksi create.
4. Kalau keduanya gagal (token sangat ramai): pakai `creator` sekarang sebagai dev, dan tandai hasil "transaksi create tidak ditemukan".
5. Dari `CreateEvent`: `deployer = user`, simpan `creator` asli, `timestamp`, `name`, `symbol`, `token_program`. Dari `TradeEvent` di transaksi yang sama dengan `user = deployer`: jumlah **dev initial buy**.

Kalau `creator` sekarang berbeda dengan deployer, UI menunjukkannya ("creator rights dipindahkan ke X"), dan keduanya di-trace.

### 6.2 Trace funder (berulang, maksimal 5 hop)

Untuk tiap wallet W, mulai dari deployer:

1. Kalau W sudah ada di tabel `wallets` dengan `funder_resolved = true`, pakai hasil cache (0 request).
2. Paginasi `getSignaturesForAddress(W)` mundur. Kalau setelah 5 halaman (5.000 signature) belum mencapai yang tertua: tandai W **aktivitas tinggi (kemungkinan CEX/service)**, berhenti.
3. Ambil sampai 10 transaksi tertua (urut dari yang paling lama). Funder = pengirim **transfer SOL System Program pertama** ke W (instruksi `transfer`/`transferWithSeed`/`createAccount` dengan tujuan W, termasuk inner instruction, jumlah > 0).
4. Kalau tidak ketemu di 10 transaksi itu: tandai W **asal tidak diketahui** (misal didanai lewat swap atau bridge), berhenti.
5. Simpan edge `funder → W` (jumlah SOL, signature, waktu). Lanjut ke funder.
6. Berhenti juga kalau: sudah 5 hop, atau funder sudah ada di rantai (loop).

### 6.3 Riwayat token dev

Tujuannya murah, karena pakai sedikit request:

1. **Jalur cepat:** `getProgramAccounts` program pump.fun dengan filter `memcmp` offset 49 = alamat deployer. Ini memberi semua bonding curve yang `creator`-nya dev (sekarang). RPC publik bisa menolak query ini di program sebesar pump.fun; ini diverifikasi di tahap spike (lihat bagian 11).
2. **Fallback:** scan 100 transaksi terbaru dev, cari `CreateEvent` dengan `user = deployer`. Kalau dev punya lebih dari itu, tandai "riwayat parsial".
3. Status setiap token lama diambil sekaligus dengan `getMultipleAccounts` (sampai 100 bonding curve per request): `complete` (sudah migrasi) dan `real_quote_reserves` (dana yang terkumpul).
4. Saldo dev di semua token itu diambil dengan `getTokenAccountsByOwner(dev)` untuk SPL Token dan Token-2022 (2 request).

**Definisi "token mati, dev kabur"** (dipakai untuk risk score): token lama yang belum `complete`, umurnya > 24 jam, dan saldo dev sekarang < 1% dari initial buy (atau nol kalau initial buy tidak diketahui). Ini sengaja tidak memakai kata "rug", karena heuristik.

### 6.4 Status dev di token ini

1. Saldo dev sekarang (dari langkah 6.3.4).
2. Scan transaksi dev setelah waktu create (maksimal 50 transaksi). Untuk setiap transaksi, bandingkan `preTokenBalances` dan `postTokenBalances` untuk mint ini:
   - saldo dev turun dan dev menerima SOL/quote → **jual** (berlaku untuk bonding curve, PumpSwap, maupun aggregator),
   - saldo dev turun dan saldo wallet lain naik dengan jumlah sama tanpa ada swap → **transfer-out**; wallet penerima ditandai insider,
   - saldo dev naik → **beli tambahan**.
3. Hasil: initial buy, total jual, total transfer-out, saldo sekarang, persen yang sudah dilepas.

Pendekatan saldo sebelum/sesudah ini sengaja dipilih supaya tidak bergantung pada nama instruksi tiap DEX.

### 6.5 Cross-link

Query DB: wallet mana di rantai ini (deployer, funder, penerima transfer-out) yang juga muncul di trace token lain. Tampilkan token-token itu.

### 6.6 Risk score v1

Penjumlahan poin, dibatasi 0–100. Setiap faktor yang aktif menghasilkan satu kalimat alasan.

| Faktor | Poin | Contoh alasan |
|---|---|---|
| Dev pernah membuat ≥3 token dan ≥50% berstatus "mati, dev kabur" | +30 | "Dev launched 14 tokens; 12 died with the dev exiting." |
| Dev sudah melepas ≥50% initial buy (jual + transfer-out) | +25 | "Dev has sold 80% of their initial buy." |
| Ada transfer-out dev ke wallet lain | +15 | "Dev moved 30M tokens to 2 other wallets." |
| Deployer didanai < 1 jam sebelum create | +10 | "Dev wallet was funded 12 minutes before launch." |
| Ada wallet di rantai funder yang juga mendanai deployer token "mati, dev kabur" lain | +20 | "Funder 7xK…9a also funded the dev of 3 dead tokens." |

Level: 0–29 rendah, 30–59 sedang, 60+ tinggi. Kalau data penting tidak lengkap (misal transaksi create tidak ditemukan), skor diberi label "data tidak lengkap".

Halaman selalu menampilkan disclaimer: analisis heuristik, bukan nasihat finansial.

Bobot disimpan di satu file konfigurasi di `packages/core` supaya mudah dikalibrasi.

### 6.7 Perkiraan biaya request (trace baru, cache kosong)

- Create + deployer: 2–6 request.
- Per hop: 1–5 halaman signature + ≤10 `getTransaction` → ±15. Lima hop: ±75.
- Riwayat dev: 3–105 (tergantung jalur cepat berhasil atau tidak).
- Status dev: ≤52.

Total kasar 80–230 request. Dengan batas ±3,5 `getTransaction`/detik di satu endpoint publik, trace dingin makan ±30–70 detik. Trace untuk wallet yang sudah di-cache jauh lebih cepat. Karena itu hasil dikirim bertahap lewat SSE.

## 7. Job, antrean, dan streaming

- `POST /api/trace` dengan body `{ mint }` → mengembalikan `{ jobId }`. Kalau ada job aktif untuk mint yang sama, kembalikan job itu (dedup). Kalau ada hasil selesai yang umurnya < 5 menit, kembalikan langsung.
- `GET /api/trace/:jobId/stream` (SSE). Event: `token` (info token & deployer), `node` (satu wallet di rantai), `edge`, `devHistory`, `devStatus`, `crosslinks`, `score`, `done`, `error`. Saat (re)connect, server mengirim ulang semua event yang sudah tersimpan untuk job itu, lalu lanjut live.
- `GET /api/token/:mint` → hasil trace terakhir dari DB (untuk link yang dibagikan dan render cepat).
- `GET /api/wallet/:address` → rantai funder wallet, token yang dibuat, dan trace lain yang memuat wallet ini.
- `GET /api/recent` → 20 trace terbaru.
- Antrean di dalam proses, konkurensi job default 2 (karena bottleneck-nya rate limit RPC, bukan CPU).
- Timeout job 5 menit. Hasil parsial tetap disimpan dan ditandai `partial`.
- Rate limit per IP pengunjung di API (misal 10 trace baru per menit) supaya satu orang tidak menghabiskan kapasitas RPC.

## 8. Data (`packages/db`)

- `tokens`: mint, name, symbol, token_program, quote_mint, deployer, creator_current, creator_original, created_at, create_signature, complete, is_mayhem_mode, dev_initial_buy, updated_at.
- `wallets`: address, funder_resolved, funder_address, funding_signature, funding_amount_lamports, funded_at, terminal_reason (`high_activity` / `unknown_origin` / null), first_seen_tx_at, fetched_at.
- `dev_tokens`: deployer, mint, complete, real_quote_reserves, dev_balance, status (`alive` / `migrated` / `dead_dev_exited`), checked_at.
- `dev_status`: mint, initial_buy, sold, transferred_out, balance, checked_at.
- `insider_transfers`: mint, from, to, amount, signature.
- `trace_jobs`: id, mint, state, partial, started_at, finished_at.
- `trace_events`: job_id, seq, type, payload_json (untuk replay SSE).
- `trace_wallets`: mint, wallet, role (`deployer` / `creator` / `funder` / `insider`), depth. Dipakai untuk cross-link.

Kebijakan cache:

- Data funder bersifat permanen (transfer pertama tidak berubah). `wallets` dengan `funder_resolved = true` tidak di-fetch ulang.
- `wallets` dengan `high_activity` dicek ulang setelah 30 hari.
- `dev_status`, `dev_tokens`, dan status bonding curve di-refresh kalau umurnya > 5 menit saat trace diminta lagi.

## 9. Frontend (`apps/web`)

**Halaman:**

- `/`: hero dengan kolom CA besar (paste langsung jalan), contoh token, daftar trace terbaru.
- `/token/:mint`:
  - header token (nama, ticker, gambar dari metadata, badge mayhem / migrated / quote),
  - kartu risk score besar dengan warna level dan daftar alasan,
  - graf rantai funder (React Flow, vertikal dari deployer ke atas). Node menunjukkan alamat singkat, jumlah SOL, dan waktu; node terminal diberi ikon sesuai alasan berhenti. Klik node membuka panel detail + link ke Solscan dan `/wallet/:address`,
  - kartu status dev (initial buy, jual, transfer-out, saldo) dengan bar,
  - tabel riwayat token dev dengan status,
  - daftar cross-link.
- `/wallet/:address`: rantai funder wallet itu, token yang dibuat, dan trace yang memuatnya.

**Perilaku:**

- Saat streaming: skeleton untuk bagian yang belum ada, node graf muncul satu per satu dengan animasi, progress bar per langkah.
- Tombol copy alamat, tombol share link.
- Responsif: di HP, graf berubah jadi daftar vertikal (timeline) karena canvas graf tidak nyaman di layar kecil.
- Tema gelap ala terminal crypto, hijau = aman, kuning = sedang, merah = bahaya. Kontras memenuhi WCAG AA.

## 10. Error handling

- CA tidak valid / bukan token pump.fun: pesan jelas di form, tanpa membuat job.
- Request RPC gagal setelah 4 kali retry: langkah itu ditandai `incomplete` di event, trace lanjut ke langkah lain, skor diberi label "data tidak lengkap".
- Semua endpoint RPC sedang cooldown: job menunggu (status "antre karena batas RPC") alih-alih gagal.
- Job melewati 5 menit: berhenti, simpan parsial, kirim `done` dengan `partial: true`.
- SSE putus: client reconnect otomatis, server replay dari `trace_events`.
- Proses API restart: job yang statusnya `running` saat start ditandai `partial`, bisa dijalankan ulang oleh request berikutnya (cache membuatnya cepat).

## 11. Spike sebelum implementasi penuh

Tiga hal ini perlu dicoba langsung ke RPC publik di awal, karena memengaruhi jalur cepat:

1. Apakah `getProgramAccounts` dengan `memcmp` offset 49 di program pump.fun diterima RPC publik dan berapa lama. Kalau ditolak, riwayat dev pakai fallback saja.
2. Apakah RPC publik mengembalikan transaksi lama (misal tahun 2024) untuk `getTransaction`. Kalau tidak, wallet yang terlalu lama ditandai `unknown_origin`.
3. Verifikasi decoder event terhadap 5 transaksi asli: `create`, `create_v2`, buy, sell di bonding curve, sell di PumpSwap.

Hasil spike dicatat di `docs/spikes/` dan spec diperbarui kalau ada yang berubah.

## 12. Testing

- `packages/core`: Vitest dengan fixture transaksi asli yang direkam ke JSON dan `ChainSource` palsu. Kasus: funder ditemukan, funder lewat inner instruction, wallet aktivitas tinggi, asal tidak diketahui, loop, batas hop, deployer ≠ creator, klasifikasi jual vs transfer-out, tiap faktor risk score.
- `packages/solana`: decoder event terhadap fixture; rate limiter dan retry dengan timer palsu.
- `apps/api`: test endpoint dan SSE replay dengan `ChainSource` palsu.
- `apps/web`: satu skenario Playwright: masukkan CA, graf dan skor muncul (backend dengan data palsu).

## 13. Di luar cakupan sub-project 1

Bundle detector, bubble map, sniper, fresh wallet holder, insider supply % (sub-project 2). Screener, socials recycle, coin tiruan (sub-project 3). Watchlist, alert Telegram, wash trading, laporan komunitas (sub-project 4). Akun user, login, pembayaran. Cek mint/freeze authority dan LP (token pump.fun dikelola protokol, nilai informasinya rendah untuk v1).

## 14. Revisi setelah perencanaan dan uji mainnet (2026-10-20)

Tidak mengubah apa yang dilihat user, kecuali poin 11.

1. Transport RPC memakai pool `fetch` sendiri (rate limit, rotasi, retry di satu kelas). `@solana/kit` tetap dipakai untuk validasi alamat, PDA, dan base58.
2. Tanpa Drizzle: tabelnya sedikit, cukup `better-sqlite3` langsung.
3. Tanpa CLI shadcn: beberapa komponen Tailwind kecil ditulis sendiri.
4. Transaksi create dicari dari signature tertua milik **akun bonding curve** (maksimal 40 halaman), bukan milik mint. Setelah migrasi semua trading pindah ke PumpSwap, jadi riwayat curve berhenti bertambah; riwayat mint token besar (misal Fartcoin) tidak terbatas. Signature create yang sudah ditemukan disimpan dan dipakai lagi di trace berikutnya.
5. Riwayat token dev diambil dari 60 transaksi terbaru dev, diambil 4 sekaligus (dipakai bersama untuk status dev lewat cache transaksi). Jalur cepat `getProgramAccounts` dihapus: akun `BondingCurve` tidak menyimpan mint.
6. Decoder event pump.fun ada di `packages/core`. Prefix event Anchor di chain adalah hash `anchor:event` yang dibalik (`e445a52e51cb9a1d`).
7. SSE tidak punya event `edge` terpisah (setiap `node` membawa `fundedBy`); ada event `step` untuk progres. Job yang terputus karena restart diakhiri dengan event `error`.
8. Halaman wallet hanya menampilkan data yang sudah ada di cache.
9. Tabel DB final: `wallets`, `tx_cache`, `tokens`, `dev_tokens`, `trace_wallets`, `trace_results`, `trace_jobs`, `trace_events`. Status dev dan transfer insider disimpan di dalam JSON hasil trace.
10. RPC wajib meminta `maxSupportedTransactionVersion: 1` (mainnet sudah punya transaksi versi 1).
11. Persen "released" dev juga menghitung selisih antara yang dibeli dan saldo sekarang, supaya penjualan yang lebih tua dari jendela scan tetap terlihat.
12. Riwayat dev juga mencocokkan field `creator` (launch lewat tool pihak ketiga ditandatangani bot). Wallet `unknown_origin` dicek ulang setelah 1 hari.

Catatan uji: `docs/spikes/2026-10-20-live-rpc.md`.
