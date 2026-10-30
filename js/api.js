// WKE - penyimpanan lokal dan komunikasi dengan App Script (spreadsheet).

const STORAGE = {
  session: 'wke.session.v1',   // sesi audit yang sedang berjalan
  queue: 'wke.queue.v1',       // data selesai yang belum berhasil diupload
  cache: 'wke.cache.v1',       // salinan terakhir data dari spreadsheet
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
// Record yang dikirim: kolom-kolom spreadsheet beserta tipenya, sehingga App Script
// tidak perlu tahu daftar kategori (cukup menambah kolom yang belum ada).
function buildUploadRecord(meta, durasi, cu) {
  const fields = [];
  KATEGORI.forEach(sec => sec.items.forEach(item => {
    fields.push({ h: itemHeader(sec, item), t: 'dur', v: Math.round(durasi[item.key] || 0) });
  }));
  CU_LIST.forEach(c => fields.push({ h: cuHeader(c), t: 'num', v: cu[c.key] || 0 }));
  return { id: meta.id, tanggal: meta.tanggal, toko: meta.toko, auditor: meta.auditor, fields };
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
  const cu = {};
  KATEGORI.forEach(sec => sec.items.forEach(item => {
    durasi[item.key] = parseDurasi(row[itemHeader(sec, item)]);
  }));
  CU_LIST.forEach(c => { cu[c.key] = parseAngka(row[cuHeader(c)]); });
  return {
    id: row['ID'] || '',
    tanggal: normalizeTanggal(row['Tanggal']),
    toko: row['Nama Toko'] || '',
    auditor: row['Nama Auditor'] || '',
    waktuUpload: row['Waktu Upload'] || '',
    durasi,
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
