var CACHE = 'cm-v1';
var ASSETS = [
  '/b.html',
  '/assets/css/middleman.css',
  '/assets/js/middleman.js'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // Only handle GET requests
  if (e.request.method !== 'GET') return;

  // For page and asset requests — cache first, network fallback
  if (ASSETS.some(function(a) { return url.pathname === a || url.pathname.startsWith('/assets/'); })) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        return cached || fetch(e.request).then(function(response) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) { cache.put(e.request, clone); });
          return response;
        });
      })
    );
    return;
  }

  // For API and Supabase requests — network only, never cache
  if (url.hostname.includes('supabase') || url.hostname.includes('cloudflare')) return;

  // Everything else — network first
  e.respondWith(fetch(e.request).catch(function() {
    return caches.match('/b.html');
  }));
});
