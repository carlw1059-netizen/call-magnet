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

self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}
  var title = data.title || 'CallMagnet';
  var body  = data.body  || '';
  var url   = data.url   || 'https://app.callmagnet.com.au';
  e.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/assets/img/icon-192.png',
      badge: '/assets/img/icon-192.png',
      data: { url: url }
    })
  );
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url)
    ? e.notification.data.url
    : 'https://app.callmagnet.com.au';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url === target && 'focus' in list[i]) {
          return list[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
