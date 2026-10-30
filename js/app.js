// WKE - navigasi, form, stopwatch, dan upload sesi.
// Data master ada di js/data.js; penyimpanan & App Script di js/api.js;
// halaman data/rata-rata di js/riwayat.js.

// ===== UTIL =====
// Semua teks dari user di-escape sebelum masuk ke innerHTML.
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pad2 = n => String(n).padStart(2, '0');

// Detik -> "HH:MM:SS" (jam boleh lebih dari 24).
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`;
}

function fmtAngka(n, desimal) {
  return Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: desimal || 0 });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "2026-10-30" -> "Jum, 30 Okt 2026"
function fmtTanggal(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso || '-';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtJam(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function newId() {
  return 'WKE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

const ALL_ITEMS = KATEGORI.flatMap(sec => sec.items.map(item => ({ sec, item })));
const ITEM_BY_KEY = Object.fromEntries(ALL_ITEMS.map(o => [o.item.key, o]));

const ICON_PLAY = '<svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
const ICON_STOP = '<svg class="icon-stop" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const ICON_EDIT = '<svg class="icon-edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_CHEVRON = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';

// ===== SESI =====
// Stopwatch disimpan sebagai { acc: ms terkumpul, start: epoch ms saat mulai | null }.
// Karena yang disimpan adalah jam mulai, waktu tetap terhitung walau aplikasi ditutup.
let session = loadJSON(STORAGE.session, null);

function createSession(meta) {
  return { id: newId(), ...meta, timers: {}, cu: {}, createdAt: Date.now(), savedAt: Date.now() };
}

let warnedStorage = false;
function persist() {
  if (session) session.savedAt = Date.now();
  const ok = saveJSON(STORAGE.session, session);
  if (!ok && !warnedStorage) {
    warnedStorage = true;
    showToast('Penyimpanan perangkat penuh/diblokir, progres bisa hilang');
  }
  updateSavedNote();
  return ok;
}

function timerOf(key) {
  return (session && session.timers[key]) || { acc: 0, start: null };
}
function elapsedMs(key, now) {
  const t = timerOf(key);
  return t.acc + (t.start ? Math.max(0, (now || Date.now()) - t.start) : 0);
}
function isRunning(key) {
  return !!timerOf(key).start;
}
function runningKeys() {
  return ALL_ITEMS.map(o => o.item.key).filter(isRunning);
}
function sessionDurasi(now) {
  const out = {};
  ALL_ITEMS.forEach(({ item }) => { out[item.key] = Math.floor(elapsedMs(item.key, now) / 1000); });
  return out;
}

// ===== MODAL & DIALOG =====
const modalCloseHooks = {};
function openModal(id) { document.getElementById(id).classList.add('show'); }
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el.classList.contains('show')) return;
  el.classList.remove('show');
  const hook = modalCloseHooks[id];
  delete modalCloseHooks[id];
  if (hook) hook();
}
function closeTopModal() {
  const open = document.querySelectorAll('.modal-overlay.show');
  if (!open.length) return false;
  closeModal(open[open.length - 1].id);
  return true;
}

// Pengganti window.confirm/alert yang cocok untuk mode aplikasi (PWA).
function confirmDialog({ title, message, ok = 'OK', cancel = 'Batal', danger = false, alertOnly = false }) {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title || 'Konfirmasi';
    document.getElementById('confirm-msg').textContent = message || '';
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    okBtn.textContent = ok;
    okBtn.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    cancelBtn.textContent = cancel;
    cancelBtn.hidden = alertOnly;

    let result = false;
    okBtn.onclick = () => { result = true; closeModal('confirm-modal'); };
    cancelBtn.onclick = () => closeModal('confirm-modal');
    modalCloseHooks['confirm-modal'] = () => resolve(result);
    openModal('confirm-modal');
  });
}

// ===== NAVIGASI =====
const SCREEN_IDS = {
  main: 'screen-main',
  form: 'screen-form',
  timer: 'screen-timer',
  ringkasan: 'screen-ringkasan',
  data: 'screen-data',
  detail: 'screen-detail',
};
// Tujuan tombol "back" bawaan HP untuk tiap layar.
const PARENT = { form: 'main', timer: 'form', ringkasan: 'timer', data: 'main', detail: 'data' };

let currentScreen = 'main';

function goTo(screen) {
  const current = document.querySelector('.screen.active');
  const next = document.getElementById(SCREEN_IDS[screen]);
  if (!next) return;

  if (current !== next) {
    current.classList.add('exit-left');
    current.classList.remove('active');
    next.style.transform = 'translateX(30px)';
    next.style.opacity = '0';
    next.classList.add('active');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      next.style.transform = '';
      next.style.opacity = '';
    }));
    setTimeout(() => current.classList.remove('exit-left'), 350);
    scrollScreenTop(next);
  }
  currentScreen = screen;
  closeDropdown();

  if (screen === 'main') renderMain();
  if (screen === 'form') fillForm();
  if (screen === 'timer') buildTimerUI();
  if (screen === 'ringkasan') renderRingkasan();
  if (screen === 'data') renderDataScreen();
  if (screen === 'detail') renderDetail();
}

function scrollScreenTop(el) {
  requestAnimationFrame(() => {
    el.scrollTop = 0;
    const content = el.querySelector('.page-content');
    if (content) content.scrollTop = 0;
  });
}

// Tombol back Android: mundur satu layar di dalam aplikasi, keluar hanya dari menu utama.
function initBackButton() {
  history.replaceState({ wke: 'base' }, '');
  history.pushState({ wke: 'top' }, '');
  window.addEventListener('popstate', () => {
    if (closeTopModal()) { history.pushState({ wke: 'top' }, ''); return; }
    const parent = PARENT[currentScreen];
    if (parent) {
      goTo(parent);
      history.pushState({ wke: 'top' }, '');
    } else {
      history.back();
    }
  });
}

// ===== MENU UTAMA =====
function renderMain() {
  const card = document.getElementById('session-card');
  const btn = document.getElementById('btn-mulai');
  if (session) {
    card.innerHTML = `<div class="session-card" onclick="goTo('timer')">
      <div class="session-card-label">Sesi tersimpan</div>
      <div class="session-card-toko">${esc(session.toko)}</div>
      <div class="session-card-meta">${esc(session.auditor)} &middot; ${esc(fmtTanggal(session.tanggal))}</div>
      <div class="session-card-status" id="main-live"></div>
    </div>
    <button class="btn-link btn-link-danger" onclick="buangSesi()">Buang sesi ini</button>`;
    btn.textContent = 'Lanjutkan';
  } else {
    card.innerHTML = '';
    btn.textContent = 'Mulai';
  }
  updateMainLive();

  const q = loadQueue().length;
  document.getElementById('main-queue').innerHTML = q
    ? `<button class="queue-chip" onclick="openData()">${q} data belum terupload &middot; kirim ulang</button>`
    : '';
}

function updateMainLive() {
  const el = document.getElementById('main-live');
  if (!el || !session) return;
  const now = Date.now();
  const running = runningKeys().length;
  const total = ALL_ITEMS.reduce((a, { item }) => a + elapsedMs(item.key, now), 0) / 1000;
  el.innerHTML = running
    ? `<span class="live-dot"></span>${running} stopwatch berjalan &middot; total ${fmtDur(total)}`
    : `Total tercatat ${fmtDur(total)}`;
}

function mulai() {
  goTo(session ? 'timer' : 'form');
}

async function buangSesi() {
  const yes = await confirmDialog({
    title: 'Buang sesi?',
    message: `Semua waktu dan CU untuk ${session.toko} akan dihapus dan tidak bisa dikembalikan.`,
    ok: 'Buang',
    danger: true,
  });
  if (!yes) return;
  session = null;
  persist();
  resetFormFields();
  renderMain();
  showToast('Sesi dibuang');
}

// ===== DROPDOWN TOKO =====
let tokoSelected = '';
let dropdownOpen = false;

function renderDropdownList(filter) {
  const q = String(filter).toLowerCase();
  const html = TOKO_LIST
    .map((t, i) => ({ t, i }))
    .filter(o => o.t.toLowerCase().includes(q))
    .map(o => `<div class="dropdown-item${o.t === tokoSelected ? ' selected' : ''}" data-idx="${o.i}">${esc(o.t)}</div>`)
    .join('');
  document.getElementById('toko-list').innerHTML = html || '<div class="dropdown-empty">Tidak ditemukan</div>';
}
function openDropdown() {
  dropdownOpen = true;
  document.getElementById('toko-list').classList.add('open');
  document.getElementById('toko-arrow').classList.add('open');
  const input = document.getElementById('toko-input');
  // Saat dibuka ulang tampilkan semua toko, bukan hanya yang cocok dengan pilihan sekarang.
  renderDropdownList(input.value === tokoSelected ? '' : input.value);
}
function closeDropdown() {
  dropdownOpen = false;
  document.getElementById('toko-list').classList.remove('open');
  document.getElementById('toko-arrow').classList.remove('open');
  const input = document.getElementById('toko-input');
  if (tokoSelected && input.value !== tokoSelected) input.value = tokoSelected;
}
function filterToko(val) {
  if (!dropdownOpen) openDropdown();
  renderDropdownList(val);
}
function selectToko(name) {
  tokoSelected = name;
  document.getElementById('toko-input').value = name;
  closeDropdown();
}

// ===== FORM DATA AUDIT =====
function resetFormFields() {
  tokoSelected = '';
  document.getElementById('toko-input').value = '';
  document.getElementById('auditor-input').value = loadJSON(STORAGE.auditor, '');
  document.getElementById('tanggal-input').value = todayISO();
}

function fillForm() {
  const tanggal = document.getElementById('tanggal-input');
  if (session) {
    tokoSelected = session.toko;
    document.getElementById('toko-input').value = session.toko;
    document.getElementById('auditor-input').value = session.auditor;
    tanggal.value = session.tanggal;
  } else if (!tanggal.value) {
    resetFormFields();
  }
}

function resetForm() {
  tokoSelected = '';
  document.getElementById('toko-input').value = '';
  document.getElementById('auditor-input').value = '';
  document.getElementById('tanggal-input').value = todayISO();
  closeDropdown();
  showToast('Data dikosongkan');
}

function lanjutForm() {
  const typed = document.getElementById('toko-input').value.trim();
  const toko = TOKO_LIST.find(t => t.toLowerCase() === typed.toLowerCase()) || '';
  const auditor = document.getElementById('auditor-input').value.trim();
  const tanggal = document.getElementById('tanggal-input').value;
  if (!toko) { showToast('Pilih nama toko dari daftar'); openDropdown(); return; }
  if (!auditor) { showToast('Isi nama auditor'); document.getElementById('auditor-input').focus(); return; }
  if (!tanggal) { showToast('Isi tanggal'); return; }

  tokoSelected = toko;
  if (session) Object.assign(session, { toko, auditor, tanggal });
  else session = createSession({ toko, auditor, tanggal });
  persist();
  saveJSON(STORAGE.auditor, auditor);
  goTo('timer');
}

// ===== STOPWATCH =====
function buildTimerUI() {
  if (!session) { goTo('form'); return; }
  document.getElementById('timer-toko').textContent = session.toko;
  document.getElementById('timer-meta').textContent = `${session.auditor} · ${fmtTanggal(session.tanggal)}`;

  let html = '';
  KATEGORI.forEach(sec => {
    html += `<div class="section-block">
      <div class="section-title-row">
        <div class="section-title">${esc(sec.label)}</div>
        <div class="section-total" data-sec-total="${sec.key}">00:00:00</div>
      </div>
      <div class="item-grid">${sec.items.map(timerItemHtml).join('')}</div>
    </div>`;
  });

  html += `<div class="section-block">
    <div class="section-title-row">
      <div class="section-title">Jumlah CU</div>
      <div class="section-total" id="cu-total">0</div>
    </div>
    <div class="item-grid">${CU_LIST.map(cuItemHtml).join('')}</div>
  </div>`;

  document.getElementById('timer-content').innerHTML = html;
  updateTimerDisplays();
  updateSavedNote();
}

function timerItemHtml(item) {
  return `<div class="timer-item" id="ti-${item.key}">
    <button type="button" class="timer-main" onclick="openManual('${item.key}')" aria-label="Input manual ${esc(item.label)}">
      <span class="timer-label"><span class="live-dot"></span>${esc(item.label)}</span>
      <span class="timer-time"><span data-time="${item.key}">00:00:00</span>${ICON_EDIT}</span>
    </button>
    <button type="button" class="play-btn" id="pb-${item.key}" onclick="toggleTimer('${item.key}')" aria-label="Mulai ${esc(item.label)}">${ICON_PLAY}${ICON_STOP}</button>
  </div>`;
}

function cuItemHtml(c) {
  const val = session.cu[c.key] || 0;
  return `<div class="cu-item">
    <label class="cu-label" for="cu-${c.key}">${esc(c.label)}</label>
    <div class="stepper">
      <button type="button" class="step-btn" onclick="stepCu('${c.key}',-1)" aria-label="Kurangi ${esc(c.label)}">&minus;</button>
      <input type="number" class="step-input no-spin" id="cu-${c.key}" min="0" inputmode="numeric" value="${val}"
        oninput="setCu('${c.key}',this.value)" onblur="this.value=session ? (session.cu['${c.key}']||0) : 0" onfocus="this.select()">
      <button type="button" class="step-btn" onclick="stepCu('${c.key}',1)" aria-label="Tambah ${esc(c.label)}">+</button>
    </div>
  </div>`;
}

// Dipanggil tiap 0,5 detik selama layar stopwatch terbuka.
function updateTimerDisplays() {
  if (!session) return;
  const now = Date.now();
  ALL_ITEMS.forEach(({ item }) => {
    const running = isRunning(item.key);
    const el = document.querySelector(`[data-time="${item.key}"]`);
    if (el) el.textContent = fmtDur(elapsedMs(item.key, now) / 1000);
    const row = document.getElementById('ti-' + item.key);
    if (row && row.classList.contains('running') !== running) {
      row.classList.toggle('running', running);
      document.getElementById('pb-' + item.key).setAttribute('aria-label', (running ? 'Stop ' : 'Mulai ') + item.label);
    }
  });
  KATEGORI.forEach(sec => {
    const el = document.querySelector(`[data-sec-total="${sec.key}"]`);
    if (el) el.textContent = fmtDur(sec.items.reduce((a, it) => a + elapsedMs(it.key, now), 0) / 1000);
  });
  const cuTotal = document.getElementById('cu-total');
  if (cuTotal) cuTotal.textContent = fmtAngka(CU_LIST.reduce((a, c) => a + (session.cu[c.key] || 0), 0));

  const n = runningKeys().length;
  const bar = document.getElementById('running-bar');
  bar.hidden = n === 0;
  document.getElementById('running-text').textContent = `${n} stopwatch berjalan`;
}

function updateSavedNote() {
  const el = document.getElementById('saved-note');
  if (el) el.textContent = session && session.savedAt ? 'Tersimpan ' + fmtJam(session.savedAt) : '';
}

function toggleTimer(key) {
  if (!session) return;
  const now = Date.now();
  const t = { ...timerOf(key) };
  if (t.start) {
    t.acc += Math.max(0, now - t.start);
    t.start = null;
  } else {
    t.start = now;
  }
  session.timers[key] = t;
  persist();
  updateTimerDisplays();
  if (navigator.vibrate) navigator.vibrate(t.start ? 20 : [15, 40, 15]);
}

function stopAll() {
  const now = Date.now();
  runningKeys().forEach(key => {
    const t = session.timers[key];
    t.acc += Math.max(0, now - t.start);
    t.start = null;
  });
}

function stopSemua() {
  if (!session || !runningKeys().length) return;
  stopAll();
  persist();
  updateTimerDisplays();
  showToast('Semua stopwatch dihentikan');
}

async function resetSemuaWaktu() {
  if (!session) return;
  const yes = await confirmDialog({
    title: 'Reset semua?',
    message: 'Semua waktu stopwatch dan jumlah CU di sesi ini akan kembali ke nol.',
    ok: 'Reset',
    danger: true,
  });
  if (!yes) return;
  session.timers = {};
  session.cu = {};
  persist();
  buildTimerUI();
  showToast('Semua waktu direset');
}

function simpanProgres() {
  if (persist()) showToast('Progres tersimpan di perangkat');
}

// ===== JUMLAH CU =====
function setCu(key, raw) {
  if (!session) return;
  const n = parseInt(raw, 10);
  session.cu[key] = Number.isFinite(n) && n > 0 ? n : 0;
  persist();
  updateTimerDisplays();
}

function stepCu(key, delta) {
  if (!session) return;
  const n = Math.max(0, (session.cu[key] || 0) + delta);
  session.cu[key] = n;
  document.getElementById('cu-' + key).value = n;
  persist();
  updateTimerDisplays();
}

// ===== INPUT WAKTU MANUAL =====
let manualKey = null;

function openManual(key) {
  if (!session) return;
  manualKey = key;
  const { sec, item } = ITEM_BY_KEY[key];
  const total = Math.floor(elapsedMs(key) / 1000);
  document.getElementById('manual-title').textContent = item.label;
  document.getElementById('manual-sub').textContent = sec.label;
  document.getElementById('manual-h').value = Math.floor(total / 3600);
  document.getElementById('manual-m').value = Math.floor(total / 60) % 60;
  document.getElementById('manual-s').value = total % 60;
  document.getElementById('manual-note').hidden = !isRunning(key);
  openModal('manual-modal');
}

function nolkanManual() {
  ['manual-h', 'manual-m', 'manual-s'].forEach(id => { document.getElementById(id).value = 0; });
}

function simpanManual() {
  if (!session || !manualKey) return;
  const num = id => Math.max(0, parseInt(document.getElementById(id).value, 10) || 0);
  const total = num('manual-h') * 3600 + num('manual-m') * 60 + num('manual-s');
  const running = isRunning(manualKey);
  session.timers[manualKey] = { acc: total * 1000, start: running ? Date.now() : null };
  persist();
  closeModal('manual-modal');
  updateTimerDisplays();
  showToast('Waktu diperbarui');
}

// ===== SELESAI & UPLOAD =====
async function selesaiAudit() {
  if (!session) return;
  const running = runningKeys().length;
  if (running) {
    const yes = await confirmDialog({
      title: 'Stopwatch masih berjalan',
      message: `${running} stopwatch masih berjalan. Hentikan semua dan lanjut ke ringkasan?`,
      ok: 'Hentikan & lanjut',
    });
    if (!yes) return;
    stopAll();
    persist();
    updateTimerDisplays();
  }
  const durasi = sessionDurasi();
  const adaData = Object.values(durasi).some(v => v > 0) || CU_LIST.some(c => session.cu[c.key] > 0);
  if (!adaData) { showToast('Belum ada waktu atau CU yang tercatat'); return; }
  goTo('ringkasan');
}

function renderRingkasan() {
  if (!session) { goTo('main'); return; }
  document.getElementById('ringkasan-content').innerHTML =
    summaryHtml([
      ['Tanggal', fmtTanggal(session.tanggal)],
      ['Nama Toko', session.toko],
      ['Nama Auditor', session.auditor],
    ]) + recordBodyHtml({ durasi: sessionDurasi(), cu: session.cu });
}

let uploading = false;
async function uploadSesi() {
  if (!session || uploading) return;
  // Jaga-jaga bila ada stopwatch yang dinyalakan lagi sebelum upload.
  if (runningKeys().length) { stopAll(); persist(); renderRingkasan(); }

  const record = buildUploadRecord(session, sessionDurasi(), session.cu);
  const btn = document.getElementById('btn-upload');
  uploading = true;
  btn.disabled = true;
  btn.textContent = 'Mengupload...';
  try {
    const res = await uploadRecord(record);
    session = null;
    persist();
    resetFormFields();
    invalidateDataCache();
    goTo('main');
    showToast(res.duplicate ? 'Data ini sudah ada di spreadsheet' : 'Data berhasil diupload');
  } catch (e) {
    // Data tidak hilang: dipindah ke antrian dan dikirim ulang saat online.
    enqueue(record, e.message);
    session = null;
    persist();
    resetFormFields();
    goTo('main');
    await confirmDialog({
      title: 'Upload belum berhasil',
      message: `${e.message}\n\nData sudah disimpan di antrian perangkat ini dan akan dikirim otomatis saat koneksi tersedia. Bisa juga dikirim ulang dari halaman Data.`,
      ok: 'Mengerti',
      alertOnly: true,
    });
  } finally {
    uploading = false;
    btn.disabled = false;
    btn.textContent = 'Upload';
  }
}

// ===== TAMPILAN HASIL (dipakai ringkasan, detail, dan rata-rata) =====
function summaryHtml(rows) {
  return `<div class="result-summary">${rows.map(([k, v]) => `
    <div class="result-summary-row"><span class="result-summary-key">${esc(k)}</span><span class="result-summary-val">${esc(v || '-')}</span></div>`).join('')}
  </div>`;
}

// view = { durasi: {key: detik}, cu: {key: jumlah} }. Untuk rata-rata, CU ditampilkan 1 desimal.
function recordBodyHtml(view, opts) {
  const desimalCu = opts && opts.avg ? 1 : 0;
  const secTotal = sec => sec.items.reduce((a, it) => a + (view.durasi[it.key] || 0), 0);
  const cuTotal = CU_LIST.reduce((a, c) => a + (view.cu[c.key] || 0), 0);

  let html = '<div class="stat-grid">';
  KATEGORI.forEach(sec => {
    html += `<div class="stat-tile"><div class="stat-label">${esc(sec.label)}</div><div class="stat-value">${fmtDur(secTotal(sec))}</div></div>`;
  });
  html += `<div class="stat-tile"><div class="stat-label">Total CU</div><div class="stat-value">${fmtAngka(cuTotal, desimalCu)}</div></div>`;
  html += '</div><div class="result-sections">';

  KATEGORI.forEach(sec => {
    html += `<div class="result-section">
      <div class="result-section-header"><span class="result-section-title">${esc(sec.label)}</span><span class="result-section-total">${fmtDur(secTotal(sec))}</span></div>
      <div class="result-section-items">${sec.items.map(it => {
        const v = view.durasi[it.key] || 0;
        return `<div class="result-item${v ? '' : ' is-zero'}"><span class="result-item-name">${esc(it.label)}</span><span class="result-item-score">${fmtDur(v)}</span></div>`;
      }).join('')}</div>
    </div>`;
  });

  html += `<div class="result-section">
    <div class="result-section-header"><span class="result-section-title">Jumlah CU</span><span class="result-section-total">${fmtAngka(cuTotal, desimalCu)}</span></div>
    <div class="result-section-items">${CU_LIST.map(c => {
      const v = view.cu[c.key] || 0;
      return `<div class="result-item${v ? '' : ' is-zero'}"><span class="result-item-name">${esc(c.label)}</span><span class="result-item-score">${fmtAngka(v, desimalCu)}</span></div>`;
    }).join('')}</div>
  </div></div>`;
  return html;
}

// ===== TOAST =====
function showToast(msg) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  container.appendChild(toast);
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2600);
}

// ===== EVENT GLOBAL =====
document.getElementById('toko-list').addEventListener('click', e => {
  const item = e.target.closest('.dropdown-item');
  if (!item) return;
  const idx = parseInt(item.dataset.idx, 10);
  if (!Number.isNaN(idx)) selectToko(TOKO_LIST[idx]);
});

document.addEventListener('click', e => {
  const wrap = document.getElementById('toko-dropdown-wrap');
  if (dropdownOpen && !wrap.contains(e.target)) closeDropdown();
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeTopModal();
  if (e.key === 'Enter' && document.getElementById('manual-modal').classList.contains('show')) simpanManual();
});

// Sesi diubah di tab/jendela lain: ikuti versi terbaru agar tidak saling menimpa.
window.addEventListener('storage', e => {
  if (e.key !== STORAGE.session) return;
  session = loadJSON(STORAGE.session, null);
  if (currentScreen === 'timer') buildTimerUI();
  if (currentScreen === 'main') renderMain();
});

window.addEventListener('online', () => {
  if (!loadQueue().length) return;
  flushQueue().then(sent => {
    if (!sent) return;
    showToast(`${sent} data antrian berhasil diupload`);
    invalidateDataCache();
    if (currentScreen === 'main') renderMain();
    if (currentScreen === 'data') renderDataScreen();
  });
});

setInterval(() => {
  if (document.hidden) return;
  if (currentScreen === 'timer') updateTimerDisplays();
  else if (currentScreen === 'main') updateMainLive();
}, 500);

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        reg.update();
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing;
          if (!newSW) return;
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
              newSW.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(err => console.log('SW gagal:', err));

    // Aman memuat ulang kapan saja: seluruh progres ada di localStorage.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

// ===== INIT =====
function initApp() {
  document.getElementById('link-spreadsheet').href = SPREADSHEET_URL;
  resetFormFields();
  renderDropdownList('');
  initBackButton();
  renderMain();
  // Ada sesi yang belum selesai: langsung kembali ke stopwatch.
  if (session) goTo('timer');
  if (loadQueue().length && navigator.onLine) {
    flushQueue().then(sent => {
      if (!sent) return;
      showToast(`${sent} data antrian berhasil diupload`);
      if (currentScreen === 'main') renderMain();
    });
  }
}
document.addEventListener('DOMContentLoaded', initApp);
