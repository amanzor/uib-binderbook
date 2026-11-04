const CACHE = 'uib-app-v4';
// Offline fallbacks only — the fetch handler below is network-first, so
// these are what a device falls back to with no connection, never what a
// connected one is served.
//
// Listed WITHOUT the `?v=` cache-busting suffixes the pages use. A pinned
// version here goes stale the moment a file is bumped, leaving an entry
// that can never match; the offline lookup already retries with
// ignoreSearch, so the bare path is both simpler and durable.
const SHELL = [
  '/',
  '/index.html',
  '/ams',
  '/manifest.json',
  '/icon.png',
  '/icons/uib-w-192.png',
  '/icons/uib-w-512.png',
  '/uib-theme.css',
  '/uib-motion.js',
  '/lz-string.min.js',
  '/storage-codec.js',
  '/supabase.js'
];
const CDN_OK = ['https://unpkg.com/', 'https://cdn.jsdelivr.net/', 'https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];
const NEVER_CACHE = ['supabase.co', 'zippopotam.us', 'nhtsa.dot.gov'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((u) => cache.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (NEVER_CACHE.some((h) => url.includes(h))) return;

  const sameOrigin = url.startsWith(self.location.origin);
  const cdn = CDN_OK.some((p) => url.startsWith(p));
  if (!sameOrigin && !cdn) return;

  event.respondWith(
    fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      caches.match(req, { ignoreSearch: false }).then((hit) => {
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('/index.html').then((r) => r || caches.match('/'));
        return caches.match(req, { ignoreSearch: true });
      })
    )
  );
});
