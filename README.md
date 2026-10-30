# WKE - Waktu Kerja Efektif

Aplikasi web (PWA) untuk mengukur **Waktu Kerja Efektif** crew di pelayanan
memakai stopwatch per kategori. Hasilnya diupload ke Google Spreadsheet.

Gaya tampilan dan daftar toko mengikuti aplikasi **Takbiran**.

## Fitur

- **Data audit**: nama toko (dropdown + pencarian, daftar dari Takbiran), nama
  auditor (diingat untuk audit berikutnya), dan tanggal (otomatis hari ini, bisa diubah).
  Tombol: *Kembali*, *Reset*, *Lanjutkan*.
- **Stopwatch per kategori** (Kasir, Server, Dining, Crew Santai):
  - Tap ▶ untuk mulai, ■ untuk berhenti. Stopwatch tidak berhenti sampai di-stop.
  - Setelah berhenti, tombol **+ Tambah hitungan** memulai hitungan baru di kategori
    yang sama, jadi satu kategori bisa punya lebih dari satu hasil hitungan.
    Total kategori = jumlah semua hitungannya.
  - Beberapa stopwatch bisa berjalan bersamaan.
  - Tap angka waktu untuk **input manual** (jam/menit/detik) atau menghapus satu hitungan.
  - Subtotal per seksi, tombol *Stop semua*.
- **Jumlah CU**: Dine In, Take Away, ShopeeFood, GoFood, GrabFood, Catering (tombol − / +).
- **Progres tidak hilang**: semua isian otomatis tersimpan di perangkat. Stopwatch
  menyimpan jam mulainya, jadi **tetap menghitung walau aplikasi/browser ditutup**.
  Saat dibuka lagi, aplikasi langsung kembali ke layar stopwatch.
  Ada juga tombol *Simpan*.
- **Selesai → Ringkasan → Upload** ke spreadsheet. Kalau gagal (misalnya offline),
  data masuk **antrian** di perangkat dan dikirim ulang otomatis saat online.
- **Halaman Data**:
  - *Riwayat*: daftar data di spreadsheet (tanggal, nama toko, nama auditor),
    bisa dicari. Tap untuk melihat semua isiannya, termasuk tiap hasil hitungan.
  - **Edit**: di halaman detail, tombol *Edit* membuka data itu kembali di layar
    stopwatch (bisa ubah waktu, tambah hitungan, ubah CU/toko/auditor/tanggal).
    *Simpan Perubahan* menimpa baris yang sama di spreadsheet. *Batalkan edit* di menu
    utama membuang perubahan tanpa mengubah spreadsheet.
  - *Rata-rata*: rata-rata waktu tiap kategori untuk **semua toko**, atau **per toko**
    (tabel perbandingan antar toko + rincian satu toko), ditambah rata-rata per hitungan.
- Bisa dipasang ke layar utama HP (PWA) dan dibuka offline.

## Pasang App Script (wajib, sekali saja)

Aplikasi berkomunikasi dengan spreadsheet lewat App Script di
`apps-script/Code.gs`. URL yang dipakai aplikasi ada di `js/data.js` (`APPS_SCRIPT_URL`).

1. Buka [spreadsheet WKE](https://docs.google.com/spreadsheets/d/183rw_qJzd8HCbObvYjiwB0mG1dTrzNxVQtn36xutkMw/edit)
   → **Ekstensi → Apps Script** (atau buka project App Script yang sudah ada).
2. Ganti seluruh isi `Code.gs` dengan isi file `apps-script/Code.gs` di repo ini, lalu **Simpan**.
3. Pilih fungsi `setup` di toolbar lalu klik **Jalankan**. Izinkan akses ke spreadsheet saat diminta.
4. Deploy:
   - **Sudah punya deployment** (URL `.../AKfycby6yH9O.../exec`): **Deploy → Kelola deployment**
     → ikon pensil → *Versi*: **Versi baru** → **Deploy**. URL tetap sama.
   - **Belum punya**: **Deploy → Deployment baru** → jenis **Aplikasi web**, lalu salin
     URL `/exec` yang baru ke `APPS_SCRIPT_URL` di `js/data.js`.
   - Pengaturan wajib: *Jalankan sebagai*: **Saya**, *Yang memiliki akses*: **Siapa saja**.

Setiap kali `Code.gs` diubah, ulangi langkah 4 (versi baru), kalau tidak perubahan tidak aktif.
Fitur **Edit** butuh `Code.gs` versi terbaru; dengan versi lama, perubahan dianggap data ganda dan tidak tersimpan.

### Format spreadsheet

Data disimpan di sheet **Data WKE** (sheet pertama dipakai langsung bila masih kosong,
kalau tidak dibuat sheet baru). Satu baris = satu audit:

| Tanggal | Nama Toko | Nama Auditor | Kasir - Taking order | … | Waktu crew santai | CU - Dine In | … | Rincian Hitungan | Waktu Upload | ID | Terakhir Diedit |
|---|---|---|---|---|---|---|---|---|---|---|---|

- Kolom waktu berisi **total** semua hitungan kategori itu, berformat durasi `[h]:mm:ss`,
  jadi bisa langsung dijumlah/dirata-rata di Sheets.
- `Rincian Hitungan` mencatat tiap hasil untuk kategori yang dihitung lebih dari sekali,
  satu baris per kategori, misalnya `Kasir - Taking order: 00:01:20, 00:00:45`.
  Kalau total kategori diubah langsung di sheet, aplikasi memakai total itu sebagai satu hitungan.
- Kolom `ID` mencegah data ganda saat upload diulang, dan dipakai untuk menemukan baris saat edit.
  Baris yang ditambahkan manual tanpa ID tidak bisa diedit dari aplikasi.
- `Terakhir Diedit` terisi saat data diubah lewat tombol Edit; `Waktu Upload` tetap waktu upload pertama.
- Kolom lain yang Anda tambahkan sendiri di sheet tidak ikut tertimpa saat edit.
- Kalau kategori baru ditambahkan di aplikasi, kolomnya otomatis ditambahkan di ujung kanan.

## Menjalankan / hosting

Aplikasi berupa file statis (tanpa build). Pilihan hosting termudah adalah **GitHub Pages**:
repo → **Settings → Pages** → *Deploy from a branch* → pilih branch dan folder `/ (root)`.

Untuk mencoba di komputer:

```bash
python3 -m http.server 8000
```

lalu buka `http://localhost:8000`.

## Mengubah data master

Semua ada di `js/data.js`:

- `TOKO_LIST`: disalin dari Takbiran (`js/data.js`). Perbarui keduanya bersamaan.
- `KATEGORI`: seksi dan item stopwatch. Jangan ubah `key` item yang sudah dipakai
  (dipakai untuk menyimpan progres); `label` boleh diubah, tetapi ingat label juga
  menjadi judul kolom di spreadsheet.
- `CU_LIST`: kanal jumlah customer.

Setelah mengubah file aplikasi, naikkan `CACHE_VERSION` di `sw.js` agar HP yang sudah
memasang aplikasi mendapat versi baru.

## Struktur file

```
index.html          Semua layar aplikasi
css/app.css         Tampilan
js/data.js          Data master + URL App Script & spreadsheet
js/api.js           Penyimpanan lokal, upload, antrian, ambil data
js/app.js           Navigasi, form, stopwatch, ringkasan & upload
js/riwayat.js       Halaman data: riwayat, detail, rata-rata
apps-script/Code.gs Backend Google Apps Script
sw.js, manifest.json, icons/   PWA (offline & pasang ke layar utama)
```
