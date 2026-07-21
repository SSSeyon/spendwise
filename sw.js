// SpendWise Service Worker
// Stale-while-revalidate for the HTML shell (instant boot, refreshed in the
// background); cache-first for version-queried assets, fonts and CDN libs.
const CACHE = 'spendwise-v18';

// Only truly-static, rarely-changing assets are pre-cached. index.html,
// app.js and styles.css are intentionally NOT pre-cached here: index.html is
// network-first below, and app.js/styles.css are loaded with a ?v= query so
// their URL changes every release (cache-busting) — pre-caching them via
// cache.add() risks capturing a stale copy from the HTTP cache at install.
const STATIC = [
  './',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
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
];
// NOTE: fonts.gstatic.com is deliberately NOT network-only. Google serves font
// binaries from immutable, hash-named URLs, so they are safe to cache forever —
// and leaving them uncached cost a blocking network round-trip on every launch
// (text paint waits on webfonts), which was a major share of online boot time.

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

  // HTML shell (page navigations and index.html): stale-while-revalidate.
  //
  // This used to be network-first, which meant every online launch blocked on a
  // full round-trip to GitHub Pages before ANYTHING painted — while offline
  // launches were instant, because the fetch failed immediately and fell
  // straight through to the cache. That asymmetry was the whole reason the app
  // felt slow to open on a connection.
  //
  // Now: return the cached shell immediately (if we have one) and refresh it in
  // the background for next time. The shell can therefore be one release behind
  // for a single launch — that is exactly what checkForUpdate() in app.js and
  // the update banner exist to cover, and forceHardRefresh() skips the wait.
  // The ?v= on app.js/styles.css inside the shell still keeps those in lockstep.
  const isHTML = req.mode === 'navigate' ||
    url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isHTML && url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = (await cache.match('./index.html')) || (await cache.match('./'));

      // {cache:'no-cache'} forces revalidation against the server (304 when
      // unchanged) instead of silently serving a max-age-fresh stale copy.
      const revalidate = fetch(new Request(url.href, { cache: 'no-cache' }))
        .then(fresh => {
          if (fresh && fresh.status === 200) cache.put('./index.html', fresh.clone());
          return fresh;
        });

      if (cached) {
        // Keep the SW alive for the background refresh, but never let a failed
        // or hanging revalidation surface as an error — we already responded.
        event.waitUntil(revalidate.catch(() => {}));
        return cached;
      }

      // Cold cache (first ever load, or after a cache wipe): we have no choice
      // but to wait for the network.
      try {
        return await revalidate;
      } catch (err) {
        return new Response('Offline — reconnect to load SpendWise.', {
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
