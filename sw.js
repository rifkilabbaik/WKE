// Service worker WKE: aplikasi tetap bisa dibuka & dipakai saat offline.
// Naikkan CACHE_VERSION setiap kali aset di PRECACHE berubah.
const CACHE_VERSION = 'v1';
const CACHE_NAME = `wke-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/data.js',
  './js/api.js',
  './js/app.js',
  './js/riwayat.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    // addAll gagal total kalau satu aset 404, jadi cache satu per satu.
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(PRECACHE.map(url => cache.add(url).catch(() => null)))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('wke-') && k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Request ke App Script/spreadsheet selalu langsung ke jaringan (data harus terbaru).
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Halaman: network-first agar update cepat terlihat, fallback ke cache saat offline.
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Aset: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
