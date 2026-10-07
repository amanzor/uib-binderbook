const CACHE = 'uib-app-v1';
const SHELL = [
  '/',
  '/index.html',
  '/rater',
  '/rater.html',
  '/ams',
  '/ams.html',
  '/manifest.json',
  '/icon.png',
  '/icons/uib-192.png',
  '/icons/uib-512.png',
  '/uib-theme.css?v=20261003a',
  '/uib-motion.js?v=20261002a',
  '/lz-string.min.js',
  '/storage-codec.js?v=20260914a',
  '/supabase.js?v=20260916a'
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
