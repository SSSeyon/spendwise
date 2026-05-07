// SpendWise Service Worker
// Cache-first for static assets, network-only for Firebase/Firestore
const CACHE = 'spendwise-v4';

const STATIC = [
  './',
  './index.html',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;500;600;700;800&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
];

// Origins that must always go to the network — never cache
const NETWORK_ONLY = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'fonts.gstatic.com',  // font files — let browser cache handle these
];

// ── Install: pre-cache static assets ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      // Add each URL individually so one failure doesn't block the rest
      return Promise.allSettled(STATIC.map(url => cache.add(url)));
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for static, network-only for Firebase ──────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go to network for Firebase and other dynamic origins
  if (NETWORK_ONLY.some(origin => url.hostname.includes(origin))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Only handle GET requests for caching
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Cache-first strategy: serve from cache, fall back to network
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const networkResponse = await fetch(event.request);

        // Only cache valid responses — clone BEFORE reading body
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          const toCache = networkResponse.clone(); // clone first, return original
          cache.put(event.request, toCache);       // cache the clone
        }

        return networkResponse; // return the original (body still intact)
      } catch (err) {
        // Offline and not cached — return a simple offline response
        return new Response('Offline — open SpendWise while connected to cache it.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })
  );
});
