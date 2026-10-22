# pumpfun.dev — Sub-project 3.5: Socials, Dev Habits, Risky Wallets

Tanggal: 2026-10-22
Status: disetujui user (desain di chat), siap direncanakan

## 1. Tujuan

- **A. Socials:** metadata token (Twitter, Telegram, website, gambar) dibaca di server; tandai sosmed/gambar yang didaur ulang dari token lain.
- **C. Dev habits:** profil kebiasaan dev dari transaksi dev yang sudah diambil trace: frekuensi launch, menit sampai dev jual, klaim creator fee.
- **D. Risky Wallets (`/risky`):** daftar wallet berisiko dari database sendiri, bahasa netral (keputusan user).

## 2. Fakta yang diverifikasi live (2026-10-21/22)

- 40 `uri` terbaru: 23 berhasil (p50 530 ms, p90 1,05 s). Host: ipfs.io 16, metadata.j7tracker.io 13, supabase 6, lain-lain.
- **ipfs.io sudah tidak melayani API**: selalu `429 "This IPFS gateway is switching to a service worker gateway only"`. Ini juga penyebab error CORS di halaman token (browser fetch ipfs.io).
- Gateway pengganti untuk CID yang sama: `ipfs.filebase.io` 6/6 (30–170 ms), `4everland.io` 6/6 (80–650 ms), `gateway.pinata.cloud` 4/6 (±5 s), `dweb.link` / `w3s.link` / `cf-ipfs.com` 0/6.
- Field JSON: `name, symbol, image, description, twitter, website, telegram, createdOn, showName`, kadang `coin_community`, `extensions`.
- 22 dari 23 punya `twitter`; **14 di antaranya link ke satu tweet** (`x.com/<user>/status/<id>`), bukan akun proyek. Beberapa token memakai tweet yang sama.
- Gambar: host axiom-cdn (nama file = mint), supabase (nama file = hash isi), j7tracker, IPFS (CID = hash isi).
- Event pump di transaksi dev (dari `tx_cache`): `CollectCreatorFeeEvent` (program pump, 96 byte) dan `CollectCoinCreatorFeeEvent` (PumpSwap) ada dan bisa dikenali dengan discriminator `sha256("event:<Name>")[..8]`.

## 3. A — Socials

### 3.1 Normalisasi (core, murni: `pump/socials.ts`)

`parseMetadata(json): ParsedMetadata` dari objek JSON metadata:

- `twitter`: hanya URL http(s) dengan host `x.com`/`twitter.com` (termasuk `www.`, `mobile.`).
  - `/<handle>/status/<id>` → `kind: "tweet"`, `handle` = pembuat tweet, `tweetId`.
  - `/i/communities/<id>` → `kind: "community"`.
  - `/<handle>` (bukan kata khusus `i, home, search, intent, share, hashtag`) → `kind: "account"`.
  - lainnya → `kind: "other"`. Handle selalu lowercase.
- `telegram`, `website`: URL http(s) saja (selain itu dibuang). `websiteKey` = host tanpa `www.`; untuk host platform umum (x.com, twitter.com, t.me, youtube.com, youtu.be, tiktok.com, instagram.com, pump.fun, dexscreener.com, github.com, google.com) kunci = host + path, supaya link video berbeda tidak dianggap sama.
- `image`: URL; `imageKey` = `ipfs:<CID>` kalau URL berisi `/ipfs/<CID>` atau `ipfs://<CID>`, selain itu URL lengkap tanpa query.
- `description`: dipotong 280 karakter.

### 3.2 Pengambilan (apps/api: `feed/metadataFetcher.ts`)

- URL IPFS (`ipfs://`, `*/ipfs/<CID>` di ipfs.io, pinata, dweb, dll.) diubah ke `https://ipfs.filebase.io/ipfs/<CID>`, cadangan `https://4everland.io/ipfs/<CID>`.
- **Aman dari SSRF:** hanya `http:`/`https:`, port default; DNS di-resolve lewat `lookup` khusus yang menolak alamat privat/loopback/link-local/CGNAT/multicast (IPv4 dan IPv6); maksimal 2 redirect, tiap redirect dicek ulang; timeout 5 s; maksimal 64 KB; harus JSON.
- Antrean: maksimal 500 item (yang terlama dibuang), 4 paralel. Gagal → dicoba sekali lagi setelah 10 menit, lalu disimpan `ok = 0`.
- Diisi oleh: FeedService (setiap token baru) dan langkah trace `socials` (kalau belum ada di DB). `METADATA_FETCH=all|traced` (default `all`).

### 3.3 Penyimpanan (`token_meta`)

`mint PK, created_at, fetched_at, ok, twitter_url, twitter_kind, twitter_handle, tweet_id, telegram, website, website_key, image, image_key, description`. Index: `twitter_handle`, `website_key`, `image_key`, `tweet_id`. Prune baris > 14 hari kecuali mint yang punya hasil trace.

### 3.4 Daur ulang

`findSocialReuse(mint, createdAt, keys)` mencari token lain dengan:

- `twitter_handle` sama **dan kedua-duanya `kind: "account"`**,
- `website_key` sama,
- `image_key` sama,

yang `created_at` ≤ `createdAt − 3600` (dibuat ≥ 1 jam lebih awal; gelombang copycat menit-menitan tidak dihitung). Maksimal 5 contoh per jenis.
`sameTweetCount` = token lain dengan `tweet_id` sama (info saja).

### 3.5 Trace, skor, tampilan

- Langkah baru `socials` setelah `token`. Hasil `TokenSocials` (lihat §6) masuk event `socials` dan `TraceResult.socials`.
- Faktor risiko `recycledSocials` **+15**: ada daur ulang (§3.4).
- Gambar header token memakai `socials.image` (sudah lewat gateway yang jalan); browser tidak lagi fetch metadata sendiri.
- Kartu **Socials**: link (hanya http(s), `rel="noopener noreferrer nofollow"`), jenis Twitter ("Project account" / "Links to a tweet by @x" / "Community"), peringatan daur ulang dengan link ke token lain, "N other tokens use the same tweet", atau "No socials listed".
- Screener: badge **recycled** (warn) kalau token itu punya daur ulang.

## 4. C — Dev habits

Dihitung di `analyzeDev` dari transaksi dev yang sudah diambil (`devTxScan` = 60):

- `launches` = token lain yang dibuat dev dalam jendela itu (sama dengan riwayat), `dead`, `migrated`.
- `launchesPerDay` = launches / rentang hari (dari launch tertua sampai sekarang, minimal 1 hari); null kalau < 2 launch.
- Per token yang create-nya terlihat: jual pertama dev = `TradeEvent` `isBuy = false`, `user = dev`, mint itu; menit = (timestamp jual − createdAt) / 60. `medianMinutesToSell`, `fastSells` = jumlah token yang dijual dev ≤ 10 menit setelah launch.
- `feeClaims` = jumlah `CollectCreatorFeeEvent` (creator = dev) + `CollectCoinCreatorFeeEvent` (coin_creator = dev), `feeClaimedSol` = total lamports / 1e9.
- `partial` = jendela 60 transaksi tidak mencakup semua riwayat.

Faktor risiko `fastSeller` **+15**: `fastSells ≥ 2`.
Kartu **Dev habits** di halaman token (kolom kanan) dan halaman wallet (dari hasil trace terbaru di mana wallet itu deployer).

## 5. D — Risky Wallets (`/risky`)

`GET /api/risky` (cache 60 s) → empat daftar, masing-masing maks 20:

| Daftar | Sumber | Syarat |
|---|---|---|
| Devs with the most dead launches | `dev_tokens` status `dead_dev_exited` per deployer | ≥ 2 |
| Funders behind dead launches | `trace_wallets` role funder → deployer → `dev_tokens` mati | ≥ 2 |
| Wallets buying early in many launches | `early_buyers` slot ≤ 2, distinct mint | ≥ 3 |
| Most launches in the last 24 h | `feed_tokens.creator` | ≥ 3 |

Baris: alamat (link ke halaman wallet), kalimat fakta ("12 launches died with the dev exiting, out of 15 seen"), waktu terakhir. Catatan di atas: heuristik dari token yang di-trace situs ini; wallet launchpad/bot bisa ikut masuk; bukan tuduhan. Link "Risky wallets" di header.

## 6. Tipe baru (`packages/shared`)

```ts
type TwitterKind = "account" | "tweet" | "community" | "other";
interface SocialReuse { kind: "twitter" | "website" | "image"; value: string; tokens: { mint: string; symbol: string | null; createdAt: number }[] }
interface TokenSocials {
  available: boolean; reason: "no_uri" | "fetch_failed" | null;
  twitter: { url: string; kind: TwitterKind; handle: string | null; tweetId: string | null } | null;
  telegram: string | null; website: string | null; image: string | null; description: string | null;
  reuse: SocialReuse[]; sameTweetCount: number;
}
interface DevProfile {
  launches: number; dead: number; migrated: number; launchesPerDay: number | null;
  soldObserved: number; medianMinutesToSell: number | null; fastSells: number;
  feeClaims: number; feeClaimedSol: number; partial: boolean;
}
```

`StepName` + `"socials"`; `TraceEvent` + `socials`, `devProfile`; `TraceResult` + `socials`, `devProfile` (hasil lama tanpa field ini dibaca sebagai null). `FeedItem` + `recycledSocials: boolean`. `WalletView` + `profile: DevProfile | null`.

## 7. Arsitektur

- `core`: `MetadataSource` (`fetch(uri): Promise<unknown | null>`), opsional di `TraceDeps`; `Store` + `getTokenMeta`, `putTokenMeta`, `findSocialReuse`. Parser dan profil murni, dites tanpa jaringan.
- `apps/api`: `MetadataFetcher` (HTTP aman + gateway) mengimplementasikan `MetadataSource`; `MetadataQueue` untuk feed.
- `db`: tabel `token_meta`, query reuse, risky lists, profil di walletView.

## 8. Tes

- core: `parseMetadata` (semua jenis twitter, URL non-http dibuang, kunci website/gambar), event fee, profil dev (menit jual, fast sells, klaim fee), langkah socials di runTrace (cache hit, fetch, gagal), faktor skor baru.
- db: token_meta round-trip, reuse (≥ 1 jam, account-only, tweet count), prune, risky lists, walletView profile, feed `recycledSocials`.
- api: gateway rewrite, penolakan IP privat/redirect/ukuran/timeout dengan server HTTP lokal + lookup palsu, antrean (batas, retry), route `/api/risky`.
- web: e2e kartu Socials, Dev habits, halaman Risky Wallets, badge recycled; cek mobile.
- Live: metadata untuk feed beberapa menit (tingkat sukses per host), satu trace penuh dengan socials + profil.

## 9. Di luar cakupan

Hash gambar dari isi file (hanya CID/URL); cek pengikut Twitter (butuh API berbayar); alert/Telegram (sub-project 4).
