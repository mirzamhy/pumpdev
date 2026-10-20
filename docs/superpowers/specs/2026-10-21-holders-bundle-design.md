# pumpfun.dev — Sub-project 2: Holders, Bundle, Bubble Map

Tanggal: 2026-10-21
Status: disetujui user (desain di chat), siap direncanakan

## 1. Tujuan

Menambah analisis holder ke trace token yang sudah ada (sub-project 1):

- jumlah holder dan 20 holder teratas dengan persen supply,
- pembeli di blok launch (bundle) dan 2 slot berikutnya (sniper), beserta berapa yang masih mereka pegang,
- cluster holder yang kemungkinan satu pemilik (funder sama, didanai dev, saling mendanai, atau menerima token dari dev),
- holder fresh wallet (aktivitas pertama < 24 jam),
- sniper berulang (pembeli awal di ≥3 token lain yang pernah di-trace),
- insider supply % dan faktor risiko baru,
- bubble map interaktif di halaman token.

Keputusan user: top 20 holder, cluster 1 hop, satu halaman, jalan otomatis dalam trace yang sama.

## 2. Fakta yang diverifikasi di mainnet (2026-10-21)

- `getTokenLargestAccounts` selalu ditolak RPC publik (429 "Too many requests for a specific RPC call"). Tidak dipakai.
- `getProgramAccounts` ke program token (SPL atau Token-2022) dengan filter `memcmp` offset 0 = mint dan `dataSlice {offset: 32, length: 40}` (owner + amount) berhasil: token di bonding curve ±300 akun / 86 KB / 0,5 s. Token besar yang sudah migrasi (Fartcoin) 578 ribu akun / 160 MB / 12 s: terlalu berat.
- `getBlock` dengan `transactionDetails: "accounts"` (jsonParsed, `maxSupportedTransactionVersion: 1`, `rewards: false`) mengembalikan ±1.500 transaksi / ±5 MB / 0,5 s per blok, termasuk `preTokenBalances`/`postTokenBalances` per owner.
- Layout akun token: mint (32) | owner (32) | amount u64 (8). Layout mint: mint_authority COption (36) | supply u64 di offset 36.

## 3. Cakupan dan batasan

- Analisis holder hanya untuk token yang **belum migrasi** (`complete = false`). Token yang sudah migrasi mendapat `available: false` dengan alasan yang ditampilkan.
- Bundle/sniper butuh slot transaksi create. Kalau create tx tidak ketemu, `earlyBuyers` = null ("tidak diketahui").
- Cluster hanya di antara 20 holder teratas.
- Funder "sibuk" (satu halaman penuh = 1.000 signature, atau tercatat `high_activity`) tidak dipakai untuk menggabungkan cluster, karena CEX menghubungkan semua orang.

## 4. Alur (langkah `holders` di `runTrace`, setelah `devActivity`)

1. Lewati kalau `token.complete` → `available: false, reason: "migrated"`.
2. Baca akun mint: total supply dan program token.
3. `getMintHolders(mint, tokenProgram)` → gabungkan per owner, buang owner = PDA bonding curve dan saldo 0. Hitung `holderCount`, urutkan, ambil 20 teratas, persen = amount / supply.
4. Pembeli awal: kalau `token.createSlot` ada, ambil perubahan saldo token di slot `createSlot`, `+1`, `+2`. Owner yang saldo mint-nya naik (bukan PDA curve, bukan deployer/creator) = pembeli awal dengan `slotOffset` 0/1/2 dan jumlah beli. Saldo sekarang diambil dari peta holder.
5. Funder holder: `resolveWallet` untuk 20 holder (3 paralel, pakai cache). `resolveWallet` sekarang juga menyimpan `firstSeenAt` (blockTime signature tertua kalau riwayat lengkap).
6. Cek funder sibuk: per funder unik, `store.getWallet` `high_activity` atau `getSignatures(limit 1000)` penuh → sibuk (cache per trace).
7. Union-find atas 20 holder: gabung holder yang funder (tidak sibuk) sama; gabung holder dengan holder yang mendanainya. Tandai `linkedToDev` kalau anggota adalah dev/creator/insider, atau funder-nya ada di set dev (deployer, creator, wallet rantai dev non-sibuk, penerima transfer dev). Cluster = grup ≥2 holder.
8. Tag holder: `dev`, `insider`, `bundle` (slot 0), `sniper` (slot 1–2), `fresh`, `repeatSniper`.
9. Sniper berulang: `store.findRepeatSnipers(pembeliAwal, mint)` → wallet yang menjadi pembeli awal di ≥3 mint lain.
10. Persen:
    - `bundlePct` = saldo sekarang pembeli slot 0 / supply.
    - `insiderPct` = saldo gabungan {deployer, creator, penerima transfer dev, pembeli slot 0, anggota cluster yang `linkedToDev` atau berisi pembeli slot 0} / supply.
    - `top10Pct`, `freshCount`.
11. Emit event `holders`.

## 5. Faktor risiko baru

| id | Syarat | Poin | Alasan |
|---|---|---|---|
| bundleHeld | bundlePct ≥ 10 | +20 | "Wallets that bought in the launch block still hold X% of supply." |
| insiderSupply | insiderPct ≥ 20 | +20 | "Dev-linked and launch-block wallets hold X% of supply." |
| holderCluster | ada cluster ≥3 anggota dengan pct ≥ 10 | +15 | "N top holders that look like one owner hold X% of supply." |
| freshHolders | freshCount ≥ 5 | +10 | "N of the top 20 holders are wallets less than a day old." |
| repeatSniper | ≥1 sniper berulang | +10 | "N launch-block buyers also bought early in 3+ other tokens we traced." |

Total tetap dibatasi 100.

## 6. Data

Tipe baru di `@pumpfun/shared`: `HolderTag`, `Holder`, `HolderCluster`, `EarlyBuyer`, `HolderAnalysis`; `TraceResult.holders: HolderAnalysis | null`; `TokenInfo.createSlot: number | null`; `StepName` + `"holders"`; event `{ type: "holders", data: HolderAnalysis }`.

`ChainSource` baru:
- `getMintHolders(mint, tokenProgram): Promise<{ owner: string; amount: string }[]>` (per akun token, belum digabung).
- `getBlockTokenChanges(slot): Promise<{ signature: string; preTokenBalances: TokenBalance[]; postTokenBalances: TokenBalance[] }[]>`.

`WalletRecord.firstSeenAt: number | null`. `Store.findRepeatSnipers(wallets, excludeMint): { wallet, count }[]`.

DB: kolom `wallets.first_seen_at` (ditambah otomatis kalau belum ada), tabel `early_buyers(mint, wallet, slot_offset, PRIMARY KEY(mint, wallet))` diisi dari `saveResult`.

## 7. Tampilan

Kartu **Holders** di halaman token (kolom utama, di bawah rantai funder):
- ringkasan: jumlah holder, insider %, bundle %, top-10 %;
- bubble map SVG (layout `d3-force`, dihitung sekali): ukuran ∝ persen, warna per cluster (abu-abu kalau tidak ber-cluster, merah untuk dev/insider), garis antar anggota cluster; hover → tooltip, klik → halaman wallet;
- tabel 20 holder: rank, alamat, persen, tag;
- daftar pembeli awal (slot +0/+1/+2, beli, masih pegang);
- pesan jelas kalau tidak tersedia (sudah migrasi / create tx tidak ketemu).

## 8. Error handling

- Gagal ambil holder atau blok → langkah `holders` `incomplete`, `holders` = null, skor ditandai tidak lengkap.
- Gagal resolve funder satu holder → holder itu tanpa funder, analisis lanjut.
- Timeout job default naik ke 8 menit.

## 9. Testing

- Core: analisis holder dengan `FakeChain` (holder map, blok palsu): agregasi & pengecualian PDA, pembeli awal per slot, cluster (funder sama, funder sibuk diabaikan, didanai holder lain, didanai dev), fresh, persen, token migrasi dilewati, create slot tidak ada.
- Skor: tiap faktor baru.
- Solana: pemetaan `getProgramAccounts` (dataSlice → owner/amount) dan `getBlock`.
- DB: kolom baru + migrasi DB lama, `early_buyers`, `findRepeatSnipers`.
- Web: reducer event `holders`, e2e bubble map dan tabel tampil.
- Mainnet: smoke test token aktif.
