// WKE - penyimpanan lokal dan komunikasi dengan App Script (spreadsheet).

const STORAGE = {
  session: 'wke.session.v1',   // sesi audit yang sedang berjalan
  queue: 'wke.queue.v1',       // data selesai yang belum berhasil diupload
  cache: 'wke.cache.v2',       // salinan terakhir data dari spreadsheet
  auditor: 'wke.auditor.v1',   // nama auditor terakhir, untuk isian otomatis
};

// localStorage bisa tidak tersedia (mode privat) atau penuh; jangan sampai app berhenti.
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

// ===== REQUEST KE APP SCRIPT =====
// Body dikirim sebagai text/plain agar tidak memicu preflight CORS yang ditolak App Script.
async function apiRequest(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(url, { ...options, signal: ctrl.signal, redirect: 'follow' });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? 'Koneksi ke server terlalu lama'
      : 'Tidak bisa terhubung ke server. Periksa koneksi internet.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error('Server error (HTTP ' + res.status + ')');
  let data;
  try {
    data = JSON.parse(await res.text());
  } catch (e) {
    throw new Error('Respons server tidak dikenali. Pastikan kode App Script WKE sudah di-deploy.');
  }
  if (!data || !data.ok) throw new Error((data && data.error) || 'Server menolak permintaan');
  return data;
}

function uploadRecord(record) {
  return apiRequest(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'upload', record }),
  });
}

async function fetchRecords() {
  const data = await apiRequest(APPS_SCRIPT_URL + '?action=list&_=' + Date.now(), { method: 'GET' });
  return (data.records || []).map(normalizeRecord).filter(Boolean);
}

// ===== FORMAT DATA =====
// Kolom teks berisi tiap hasil hitungan untuk kategori yang dihitung lebih dari sekali,
// satu baris per kategori: "Kasir - Taking order: 00:01:20, 00:00:45".
const H_RINCIAN = 'Rincian Hitungan';

const pad2 = n => String(n).padStart(2, '0');

// Detik -> "HH:MM:SS" (jam boleh lebih dari 24).
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}

// Record yang dikirim: kolom-kolom spreadsheet beserta tipenya, sehingga App Script
// tidak perlu tahu daftar kategori (cukup menambah kolom yang belum ada).
// hitungan = { key: [detik, ...] }; kolom kategori berisi totalnya.
// edit = true: menimpa baris dengan ID yang sama di spreadsheet.
function buildUploadRecord(meta, hitungan, cu, edit) {
  const fields = [];
  const rincian = [];
  KATEGORI.forEach(sec => sec.items.forEach(item => {
    const list = hitungan[item.key] || [];
    const h = itemHeader(sec, item);
    fields.push({ h, t: 'dur', v: list.reduce((a, s) => a + s, 0) });
    if (list.length > 1) rincian.push(`${h}: ${list.map(s => fmtDur(s)).join(', ')}`);
  }));
  CU_LIST.forEach(c => fields.push({ h: cuHeader(c), t: 'num', v: cu[c.key] || 0 }));
  fields.push({ h: H_RINCIAN, t: 'text', v: rincian.join('\n') });
  return { id: meta.id, tanggal: meta.tanggal, toko: meta.toko, auditor: meta.auditor, edit: !!edit, fields };
}

function parseRincian(text) {
  const out = {};
  String(text == null ? '' : text).split(/\r?\n/).forEach(line => {
    const i = line.lastIndexOf(': ');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 2).split(',').map(parseDurasi);
  });
  return out;
}

// "1:05:30", "05:30", atau "1.05.30" (format lokal Indonesia) -> detik.
function parseDurasi(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return 0;
  const parts = s.split(/[:.]/).map(p => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// Jumlah CU selalu bilangan bulat; buang pemisah ribuan apa pun formatnya.
function parseAngka(text) {
  const n = parseInt(String(text == null ? '' : text).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

// Tanggal yang diketik manual di sheet ("30/10/2026") disamakan jadi "2026-10-30".
function normalizeTanggal(text) {
  const s = String(text || '').trim();
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s;
}

// Baris spreadsheet (objek judul kolom -> nilai tampilan) -> record aplikasi.
function normalizeRecord(row) {
  if (!row) return null;
  const durasi = {};
  const hitungan = {};
  const cu = {};
  const rincian = parseRincian(row[H_RINCIAN]);
  KATEGORI.forEach(sec => sec.items.forEach(item => {
    const h = itemHeader(sec, item);
    const total = parseDurasi(row[h]);
    const list = (rincian[h] || []).filter(s => s > 0);
    durasi[item.key] = total;
    // Rincian dipakai hanya bila cocok dengan totalnya (total bisa saja diubah langsung di sheet).
    hitungan[item.key] = list.length > 1 && Math.abs(list.reduce((a, s) => a + s, 0) - total) <= 1
      ? list
      : (total > 0 ? [total] : []);
  }));
  CU_LIST.forEach(c => { cu[c.key] = parseAngka(row[cuHeader(c)]); });
  return {
    id: row['ID'] || '',
    tanggal: normalizeTanggal(row['Tanggal']),
    toko: row['Nama Toko'] || '',
    auditor: row['Nama Auditor'] || '',
    waktuUpload: row['Waktu Upload'] || '',
    terakhirDiedit: row['Terakhir Diedit'] || '',
    durasi,
    hitungan,
    cu,
  };
}

// ===== ANTRIAN UPLOAD =====
// Data yang gagal diupload (mis. offline) disimpan di sini dan dikirim ulang otomatis.
function loadQueue() { return loadJSON(STORAGE.queue, []); }
function saveQueue(q) { saveJSON(STORAGE.queue, q.length ? q : null); }

function enqueue(record, errMsg) {
  const q = loadQueue().filter(r => r.id !== record.id);
  q.push({ ...record, lastError: errMsg || '', queuedAt: Date.now() });
  saveQueue(q);
}

let flushing = null;
// Mengembalikan jumlah data yang berhasil dikirim.
function flushQueue() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const rec of loadQueue()) {
      try {
        const { lastError, queuedAt, ...record } = rec;
        await uploadRecord(record);
        saveQueue(loadQueue().filter(r => r.id !== rec.id));
        sent++;
      } catch (e) {
        saveQueue(loadQueue().map(r => r.id === rec.id ? { ...r, lastError: e.message } : r));
        break; // kemungkinan besar masih offline; coba lagi nanti
      }
    }
    return sent;
  })().finally(() => { flushing = null; });
  return flushing;
}
