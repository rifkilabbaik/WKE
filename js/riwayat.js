// WKE - halaman data dari spreadsheet: riwayat, detail, antrian upload, dan rata-rata.

let dataRecords = null;     // record dari spreadsheet (atau cache terakhir)
let dataLoadedAt = 0;
let dataStale = true;       // true = perlu ambil ulang dari spreadsheet
let dataLoading = false;
let dataError = '';
let dataTab = 'riwayat';
let avgMode = 'semua';
let detailRecord = null;

function openData() {
  goTo('data');
}

// Dipanggil setelah upload berhasil agar halaman Data mengambil ulang dari server.
function invalidateDataCache() {
  dataStale = true;
}

function renderDataScreen() {
  if (!dataRecords) {
    const cache = loadJSON(STORAGE.cache, null);
    if (cache && Array.isArray(cache.records)) {
      dataRecords = cache.records;
      dataLoadedAt = cache.at;
    }
  }
  renderQueueBox();
  renderRiwayat();
  renderRataRata();
  updateDataStatus();
  if (!dataLoading && (dataStale || Date.now() - dataLoadedAt > 60 * 1000)) loadData();
}

async function loadData() {
  if (dataLoading) return;
  dataLoading = true;
  dataError = '';
  updateDataStatus();
  try {
    if (loadQueue().length) {
      const sent = await flushQueue();
      if (sent) showToast(`${sent} data antrian berhasil diupload`);
      renderQueueBox();
    }
    const records = await fetchRecords();
    records.sort((a, b) => (b.tanggal + b.waktuUpload).localeCompare(a.tanggal + a.waktuUpload));
    dataRecords = records;
    dataLoadedAt = Date.now();
    dataStale = false;
    saveJSON(STORAGE.cache, { at: dataLoadedAt, records });
  } catch (e) {
    dataError = e.message;
    showToast(e.message);
  } finally {
    dataLoading = false;
    if (currentScreen === 'data') {
      renderQueueBox();
      renderRiwayat();
      renderRataRata();
      updateDataStatus();
    }
  }
}

function updateDataStatus() {
  const el = document.getElementById('data-status');
  document.getElementById('btn-refresh').classList.toggle('spinning', dataLoading);
  if (dataLoading) { el.textContent = 'Memuat data...'; return; }
  const n = dataRecords ? dataRecords.length : 0;
  const when = dataLoadedAt
    ? new Date(dataLoadedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : '';
  if (dataError) el.textContent = dataRecords ? `Offline · menampilkan data ${when}` : 'Gagal memuat data';
  else el.textContent = dataRecords ? `${n} data · diperbarui ${when}` : '-';
}

function setDataTab(tab) {
  dataTab = tab;
  document.querySelectorAll('#screen-data .tab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  document.getElementById('tab-riwayat').hidden = tab !== 'riwayat';
  document.getElementById('tab-rata').hidden = tab !== 'rata';
  scrollScreenTop(document.getElementById('screen-data'));
}

// ===== ANTRIAN =====
function renderQueueBox() {
  const q = loadQueue();
  const box = document.getElementById('queue-box');
  if (!q.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="queue-box">
    <div class="queue-head">
      <div>
        <div class="queue-title">${q.length} data belum terupload</div>
        <div class="queue-desc">Tersimpan di perangkat ini. ${esc(q[q.length - 1].lastError || '')}</div>
      </div>
      <button class="btn btn-primary btn-small" onclick="kirimUlang()">Kirim ulang</button>
    </div>
    ${q.map(r => `<div class="queue-item">
      <button class="queue-item-main" onclick="openDetailQueue('${esc(r.id)}')">
        <span class="data-date">${esc(fmtTanggal(r.tanggal))}</span>
        <span class="queue-item-toko">${esc(r.toko)} &middot; ${esc(r.auditor)}</span>
      </button>
      <button class="btn-link btn-link-danger" onclick="hapusAntrian('${esc(r.id)}')">Hapus</button>
    </div>`).join('')}
  </div>`;
}

async function kirimUlang() {
  if (!navigator.onLine) { showToast('Perangkat sedang offline'); return; }
  const before = loadQueue().length;
  const sent = await flushQueue();
  renderQueueBox();
  if (sent) {
    showToast(`${sent} data berhasil diupload`);
    invalidateDataCache();
    loadData();
  } else if (before) {
    const q = loadQueue();
    showToast('Gagal: ' + ((q[0] && q[0].lastError) || 'coba lagi nanti'));
  }
}

async function hapusAntrian(id) {
  const rec = loadQueue().find(r => r.id === id);
  if (!rec) return;
  const yes = await confirmDialog({
    title: 'Hapus dari antrian?',
    message: `Data ${rec.toko} (${fmtTanggal(rec.tanggal)}) belum terupload dan akan hilang permanen.`,
    ok: 'Hapus',
    danger: true,
  });
  if (!yes) return;
  saveQueue(loadQueue().filter(r => r.id !== id));
  renderQueueBox();
  showToast('Data dihapus dari antrian');
}

// Record antrian berformat upload (kolom + nilai); ubah ke format tampilan.
function queueToRecord(q) {
  const row = { 'ID': q.id, 'Tanggal': q.tanggal, 'Nama Toko': q.toko, 'Nama Auditor': q.auditor };
  q.fields.forEach(f => { row[f.h] = f.v; });
  return { ...normalizeRecord(row), pending: true };
}

// ===== RIWAYAT =====
function renderRiwayat() {
  const list = document.getElementById('riwayat-list');
  if (!dataRecords) {
    list.innerHTML = `<div class="empty-state">${dataLoading ? 'Memuat data...' : esc(dataError || 'Belum ada data')}</div>`;
    return;
  }
  const q = document.getElementById('data-search').value.trim().toLowerCase();
  const rows = dataRecords
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !q || r.toko.toLowerCase().includes(q) || r.auditor.toLowerCase().includes(q));
  if (!rows.length) {
    list.innerHTML = `<div class="empty-state">${q ? 'Tidak ditemukan' : 'Belum ada data di spreadsheet'}</div>`;
    return;
  }
  list.innerHTML = rows.map(({ r, i }) => `
    <button class="data-item" onclick="openDetail(${i})">
      <span class="data-date">${esc(fmtTanggal(r.tanggal))}</span>
      <span class="data-main">
        <span class="data-toko">${esc(r.toko)}</span>
        <span class="data-auditor">${esc(r.auditor)}</span>
      </span>
      ${ICON_CHEVRON}
    </button>`).join('');
}

// ===== DETAIL =====
function openDetail(idx) {
  detailRecord = dataRecords && dataRecords[idx];
  if (detailRecord) goTo('detail');
}

function openDetailQueue(id) {
  const q = loadQueue().find(r => r.id === id);
  if (!q) return;
  detailRecord = queueToRecord(q);
  goTo('detail');
}

function renderDetail() {
  const r = detailRecord;
  if (!r) { goTo('data'); return; }
  document.getElementById('detail-title').textContent = r.toko;
  document.getElementById('detail-sub').textContent = r.pending ? 'Belum terupload' : fmtTanggal(r.tanggal);
  const rows = [
    ['Tanggal', fmtTanggal(r.tanggal)],
    ['Nama Toko', r.toko],
    ['Nama Auditor', r.auditor],
  ];
  if (r.waktuUpload) rows.push(['Waktu Upload', r.waktuUpload]);
  if (r.terakhirDiedit) rows.push(['Terakhir Diedit', r.terakhirDiedit]);
  if (r.pending) rows.push(['Status', 'Menunggu upload']);
  document.getElementById('detail-content').innerHTML = summaryHtml(rows) + recordBodyHtml(r);
  // Baris yang dibuat manual di sheet (tanpa ID) tidak bisa ditimpa, jadi tidak bisa diedit.
  document.getElementById('btn-edit').hidden = !r.id;
}

function editDetail() {
  const r = detailRecord;
  if (!r || !r.id) return;
  if (r.pending) {
    const original = loadQueue().find(q => q.id === r.id);
    if (!original) { showToast('Data sudah tidak ada di antrian'); goTo('data'); return; }
    mulaiEdit(r, { kind: 'queue', original });
  } else {
    mulaiEdit(r, { kind: 'server' });
  }
}

// ===== RATA-RATA =====
function setAvgMode(mode) {
  avgMode = mode;
  document.querySelectorAll('#tab-rata .segmented button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  renderRataRata();
}

// durasi = rata-rata total per audit; perHitungan = rata-rata tiap kali dihitung.
function averageOf(records) {
  const n = records.length || 1;
  const durasi = {};
  const perHitungan = {};
  const cu = {};
  ALL_ITEMS.forEach(({ item }) => {
    durasi[item.key] = sum(records.map(r => r.durasi[item.key] || 0)) / n;
    const all = records.flatMap(r => (r.hitungan && r.hitungan[item.key]) || []);
    perHitungan[item.key] = { n: all.length, avg: all.length ? sum(all) / all.length : 0 };
  });
  CU_LIST.forEach(c => {
    cu[c.key] = sum(records.map(r => r.cu[c.key] || 0)) / n;
  });
  return { durasi, perHitungan, cu };
}

function groupByToko(records) {
  const map = new Map();
  records.forEach(r => {
    if (!map.has(r.toko)) map.set(r.toko, []);
    map.get(r.toko).push(r);
  });
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'id'));
}

function renderRataRata() {
  const out = document.getElementById('avg-content');
  const select = document.getElementById('avg-toko');
  select.hidden = avgMode !== 'toko';

  if (!dataRecords || !dataRecords.length) {
    out.innerHTML = `<div class="empty-state">${dataLoading ? 'Memuat data...' : 'Belum ada data untuk dihitung'}</div>`;
    return;
  }

  const groups = groupByToko(dataRecords);

  if (avgMode === 'semua') {
    out.innerHTML = `<div class="avg-note">Rata-rata dari <b>${dataRecords.length}</b> data di <b>${groups.length}</b> toko</div>`
      + recordBodyHtml(averageOf(dataRecords), { avg: true });
    return;
  }

  const prev = select.value;
  select.innerHTML = '<option value="">Bandingkan semua toko</option>'
    + groups.map(([toko, recs]) => `<option value="${esc(toko)}">${esc(toko)} (${recs.length} data)</option>`).join('');
  select.value = groups.some(([t]) => t === prev) ? prev : '';

  if (select.value) {
    const recs = groups.find(([t]) => t === select.value)[1];
    out.innerHTML = `<div class="avg-note">Rata-rata <b>${esc(select.value)}</b> dari <b>${recs.length}</b> data</div>`
      + recordBodyHtml(averageOf(recs), { avg: true });
    return;
  }

  // Tabel perbandingan: rata-rata total tiap seksi per toko. Tap baris untuk rinciannya.
  const secTotal = (view, sec) => sec.items.reduce((a, it) => a + view.durasi[it.key], 0);
  out.innerHTML = `<div class="avg-note">Rata-rata per toko. Tap nama toko untuk melihat rincian.</div>
    <div class="table-wrap"><table class="avg-table">
      <thead><tr><th>Toko</th><th>Data</th>${KATEGORI.map(s => `<th>${esc(s.label)}</th>`).join('')}<th>CU</th></tr></thead>
      <tbody>${groups.map(([toko, recs], i) => {
        const v = averageOf(recs);
        const cu = CU_LIST.reduce((a, c) => a + v.cu[c.key], 0);
        return `<tr onclick="pilihTokoAvg(${i})">
          <td class="avg-toko-cell">${esc(toko)}</td><td>${recs.length}</td>
          ${KATEGORI.map(s => `<td>${fmtDur(secTotal(v, s))}</td>`).join('')}
          <td>${fmtAngka(cu, 1)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function pilihTokoAvg(i) {
  const groups = groupByToko(dataRecords || []);
  if (!groups[i]) return;
  const select = document.getElementById('avg-toko');
  select.value = groups[i][0];
  renderRataRata();
  scrollScreenTop(document.getElementById('screen-data'));
}
