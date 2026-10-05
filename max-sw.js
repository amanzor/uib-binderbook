// MAX by UIB — service worker: network first, cache fallback for the app shell.
const CACHE = 'uib-max-v2';
const SHELL = ['/max', '/max/max.js?v=20261006b', '/max/manifest.webmanifest', '/max/privacy', '/icon.png', '/icons/rater-192.png', '/icons/rater-512.png', '/icons/rater-180.png'];
const NEVER_CACHE = ['supabase.co', 'nhtsa.dot.gov'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  if (NEVER_CACHE.some((h) => req.url.includes(h))) return;
  const sameOrigin = req.url.startsWith(self.location.origin);
  const cdn = req.url.startsWith('https://fonts.googleapis.com/') || req.url.startsWith('https://fonts.gstatic.com/');
  if (!sameOrigin && !cdn) return;
  e.respondWith(fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); } return res; })
    .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/max') : caches.match(req, { ignoreSearch: true })))));
});
