/**
 * Backend aplikasi WKE (Waktu Kerja Efektif) di Google Spreadsheet.
 *
 * Cara pasang (lihat juga README.md):
 * 1. Buka project App Script, ganti seluruh isi Code.gs dengan file ini, lalu Simpan.
 * 2. Jalankan fungsi `setup` sekali untuk memberi izin akses spreadsheet.
 * 3. Deploy > Kelola deployment > Edit (ikon pensil) > Versi: "Versi baru" > Deploy.
 *    Pastikan "Jalankan sebagai: Saya" dan "Yang memiliki akses: Siapa saja".
 *
 * Aplikasi mengirim daftar kolom beserta tipenya, jadi kategori baru di aplikasi
 * otomatis menjadi kolom baru di sheet tanpa perlu mengubah kode ini.
 * Data yang diedit dari aplikasi (edit: true) menimpa baris dengan ID yang sama.
 */

const SPREADSHEET_ID = '183rw_qJzd8HCbObvYjiwB0mG1dTrzNxVQtn36xutkMw';
const SHEET_NAME = 'Data WKE';

const H_TANGGAL = 'Tanggal';
const H_TOKO = 'Nama Toko';
const H_AUDITOR = 'Nama Auditor';
const H_UPLOAD = 'Waktu Upload';
const H_ID = 'ID';
const H_EDIT = 'Terakhir Diedit';

const FORMAT_DURASI = '[h]:mm:ss';
const FORMAT_TANGGAL = 'dd/mm/yyyy';
const FORMAT_WAKTU = 'dd/mm/yyyy hh:mm:ss';
const FORMAT_TEKS = '@';

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'list') return json_({ ok: true, records: listRecords_() });
    return json_({ ok: true, app: 'WKE' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'upload') return json_(saveRecord_(body.record));
    return json_({ ok: false, error: 'Aksi tidak dikenal' });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

/** Jalankan sekali dari editor untuk memberi izin & menyiapkan sheet. */
function setup() {
  const sh = getSheet_();
  Logger.log('Siap. Data akan disimpan di sheet "' + sh.getName() + '".');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (sh) return sh;
  // Sheet pertama yang masih kosong dipakai langsung agar data tampil di tab utama.
  const first = ss.getSheets()[0];
  if (first.getLastRow() === 0 && first.getLastColumn() === 0) {
    first.setName(SHEET_NAME);
    return first;
  }
  return ss.insertSheet(SHEET_NAME);
}

// Menambahkan judul kolom yang belum ada (di ujung kanan) dan mengembalikan seluruh judul.
function ensureHeaders_(sh, wanted) {
  const lastCol = sh.getLastColumn();
  const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0] : [];
  const missing = wanted.filter(function (h) { return headers.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    Array.prototype.push.apply(headers, missing);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fff7ed');
    sh.setFrozenRows(1);
  }
  return headers;
}

function saveRecord_(rec) {
  if (!rec || !rec.id || !rec.toko || !rec.auditor || !Array.isArray(rec.fields)) {
    return { ok: false, error: 'Data tidak lengkap' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rec.tanggal))) {
    return { ok: false, error: 'Format tanggal tidak valid' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sh = getSheet_();
    const fieldHeaders = rec.fields.map(function (f) { return String(f.h); });
    const wanted = [H_TANGGAL, H_TOKO, H_AUDITOR].concat(fieldHeaders, [H_UPLOAD, H_ID]);
    if (rec.edit) wanted.push(H_EDIT);
    const headers = ensureHeaders_(sh, wanted);

    // Cari baris dengan ID yang sama.
    const idCol = headers.indexOf(H_ID) + 1;
    const lastRow = sh.getLastRow();
    let r = 0;
    if (lastRow > 1) {
      const ids = sh.getRange(2, idCol, lastRow - 1, 1).getDisplayValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] === String(rec.id)) { r = i + 2; break; }
      }
    }
    // Upload biasa dengan ID yang sudah ada = kiriman ulang dari antrian; jangan buat baris ganda.
    if (r && !rec.edit) return { ok: true, duplicate: true };
    const isNew = !r;
    if (isNew) r = lastRow + 1;

    // Ditulis per sel agar kolom lain di baris itu (mis. rumus buatan sendiri) tidak tertimpa.
    function put(header, value, format) {
      sh.getRange(r, headers.indexOf(header) + 1).setNumberFormat(format).setValue(value);
    }

    put(H_TANGGAL, Utilities.parseDate(rec.tanggal, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'), FORMAT_TANGGAL);
    put(H_TOKO, String(rec.toko), FORMAT_TEKS);
    put(H_AUDITOR, String(rec.auditor), FORMAT_TEKS);
    rec.fields.forEach(function (f) {
      if (f.t === 'dur') put(String(f.h), Math.max(0, Number(f.v) || 0) / 86400, FORMAT_DURASI);
      else if (f.t === 'num') put(String(f.h), Math.max(0, Number(f.v) || 0), '0');
      else put(String(f.h), String(f.v == null ? '' : f.v), FORMAT_TEKS);
    });
    if (isNew) put(H_UPLOAD, new Date(), FORMAT_WAKTU);
    else put(H_EDIT, new Date(), FORMAT_WAKTU);
    put(H_ID, String(rec.id), FORMAT_TEKS);

    return { ok: true, row: r, updated: !isNew };
  } finally {
    lock.releaseLock();
  }
}

// Setiap baris dikembalikan sebagai objek { judul kolom: nilai tampilan }.
// Durasi dikirim apa adanya ("1:05:30") dan diurai oleh aplikasi.
function listRecords_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return [];

  const range = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn());
  const values = range.getValues();
  const display = range.getDisplayValues();
  const headers = display[0];
  const tz = ss.getSpreadsheetTimeZone();
  const out = [];

  for (let i = 1; i < values.length; i++) {
    const rec = {};
    let filled = false;
    headers.forEach(function (h, c) {
      if (!h) return;
      let v = display[i][c];
      const raw = values[i][c];
      const isDate = Object.prototype.toString.call(raw) === '[object Date]';
      if (isDate && h === H_TANGGAL) v = Utilities.formatDate(raw, tz, 'yyyy-MM-dd');
      if (isDate && (h === H_UPLOAD || h === H_EDIT)) v = Utilities.formatDate(raw, tz, 'yyyy-MM-dd HH:mm:ss');
      if (v !== '') filled = true;
      rec[h] = v;
    });
    if (filled) out.push(rec);
  }
  return out;
}
