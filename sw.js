// SpendWise Service Worker
// Network-first (revalidated) for the HTML shell so the version pointer is
// never stale; cache-first for version-queried assets and CDN libs.
const CACHE = 'spendwise-v17';

// Only truly-static, rarely-changing assets are pre-cached. index.html,
// app.js and styles.css are intentionally NOT pre-cached here: index.html is
// network-first below, and app.js/styles.css are loaded with a ?v= query so
// their URL changes every release (cache-busting) — pre-caching them via
// cache.add() risks capturing a stale copy from the HTTP cache at install.
const STATIC = [
  './',
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
  'generativelanguage.googleapis.com',
  'fonts.gstatic.com',
];

// ── Skip waiting when told to (used by Force Hard Refresh and update banner)
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Install: pre-cache static assets ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => Promise.allSettled(STATIC.map(url => cache.add(url))))
    // Do NOT call skipWaiting() here — wait for explicit message or forceHardRefresh
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

// ── Fetch ─────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Always go to network for Firebase and other dynamic origins
  if (NETWORK_ONLY.some(origin => url.hostname.includes(origin))) {
    event.respondWith(fetch(req));
    return;
  }

  // Only handle GET requests
  if (req.method !== 'GET') {
    event.respondWith(fetch(req));
    return;
  }

  // HTML shell (page navigations and index.html): network-first with
  // revalidation, so a new release is always picked up while online. The
  // ?v= on app.js/styles.css referenced inside then forces those to refresh
  // in lockstep. Falls back to cache when offline.
  const isHTML = req.mode === 'navigate' ||
    url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isHTML && url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        // {cache:'no-cache'} forces revalidation against the server (304 when
        // unchanged) instead of silently serving a max-age-fresh stale copy.
        const fresh = await fetch(new Request(url.href, { cache: 'no-cache' }));
        if (fresh && fresh.status === 200) {
          const cache = await caches.open(CACHE);
          cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('Offline — reconnect to load SpendWise.', {
            status: 503, headers: { 'Content-Type': 'text/plain' },
          });
      }
    })());
    return;
  }

  // Everything else (version-queried app.js/styles.css, CDN libs, fonts,
  // manifest): cache-first. Version-queried URLs are immutable per release,
  // so a cached copy is always the correct one for that URL.
  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const networkResponse = await fetch(req);
        if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
          cache.put(req, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        return new Response('Offline — open SpendWise while connected to cache it.', {
          status: 503, headers: { 'Content-Type': 'text/plain' },
        });
      }
    })
  );
});
