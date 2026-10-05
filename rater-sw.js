// ============================================================
//  UIB Auto Rater — service worker
//  ------------------------------------------------------------
//  Makes the rater installable on iPhone / Android and lets it
//  open instantly (and offline) once it has been visited.
//
//  Strategy
//    • App shell files: network first, fall back to cache
//      (so a deploy is picked up on the next open, but the app
//      still opens with no signal).
//    • Supabase / carrier / lookup calls: never cached.
//
//  Bump CACHE whenever the shell files change in a way that
//  must invalidate old copies.
// ============================================================
const CACHE = 'uib-rater-v25';
const SHELL = [
  '/rater',
  '/rater.html',
  '/rater.js?v=20261006c',
  '/rater.webmanifest',
  '/uib-theme.css?v=20261003a',
  '/uib-motion.js?v=20261002a',
  '/lz-string.min.js',
  '/storage-codec.js?v=20260914a',
  '/supabase.js?v=20260916a',
  '/icon.png',
  '/icons/rater-192.png',
  '/icons/rater-512.png',
  '/icons/rater-180.png'
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
        // Navigations fall back to the rater shell when offline.
        if (req.mode === 'navigate') return caches.match('/rater.html').then((r) => r || caches.match('/rater'));
        return caches.match(req, { ignoreSearch: true });
      })
    )
  );
});
