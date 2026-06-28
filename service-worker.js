// CACHE_VERSION must be bumped on every significant visual or functional change.
// Format: callmagnet-v[N]-[short-description]
// Last bumped: 26 Jun 2026 — bust cache to deliver #app background-color fix
const CACHE_VERSION = 'callmagnet-v64-20260628';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const HTML_CACHE = `${CACHE_VERSION}-html`;

const STATIC_ASSETS = [
  '/manifest.json?v=2026-05-17',
  '/favicon.ico?v=2026-05-14',
  '/favicon-16x16.png?v=2026-05-14',
  '/favicon-32x32.png?v=2026-05-14',
  '/apple-touch-icon.png?v=2026-05-14',
  '/android-chrome-192x192.png?v=2026-05-14',
  '/android-chrome-512x512.png?v=2026-05-14',
  '/icon.svg?v=2026-05-14'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Caller pages (/b/<slug>) must never be touched by the service worker —
  // they are public, per-restaurant, and must never fall back to the PWA root.
  if (url.pathname === '/b.html' || url.pathname.startsWith('/b/')) return;

  // Never cache Supabase API or auth calls — always network
  if (url.hostname.includes('supabase.co')) return;

  // Never cache POST/PUT/DELETE requests
  if (event.request.method !== 'GET') return;

  // HTML: network-first, fall back to cache
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(HTML_CACHE).then((cache) => cache.put(event.request, copy)).catch(() => null);
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // Static assets: cache-first, fall back to network
  if (
    url.pathname.match(/\.(png|jpg|jpeg|svg|ico|webp|woff2|woff|ttf|css|js|json)$/) ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, copy)).catch(() => null);
          return response;
        });
      }).catch(() => fetch(event.request))
    );
    return;
  }

  // Everything else: network-only
});
