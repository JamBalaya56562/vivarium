// Vivarium reproduction-page service worker.
//
// Caches Pyodide / Ruby.wasm / php-wasm runtime files so repeat visits
// to any /repro/<slug>/ page are near-instant (no CDN fetch). First
// visits go to the network; the response is stored in CacheStorage so
// the next visit (any tab, any reproduction) hits cache.
//
// Scope is /vivarium/repro/ — every reproduction page is in this tree.
// Pages outside (the rspress docs site itself) are not affected.

const CACHE_NAME = 'vivarium-runtimes-v1';

// URLs we cache. Match by hostname rather than full URL so any
// pinned-version Pyodide / Ruby.wasm / php-wasm asset slots in.
const CACHED_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com'];

// ── lifecycle ──────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  // Activate immediately on first install — no need to wait for old SWs
  // to release; this is a brand-new service.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Take control of every open page in scope right away.
      self.clients.claim(),
      // Drop old caches if we ever bump CACHE_NAME.
      caches.keys().then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      ),
    ]),
  );
});

// ── fetch handler — stale-while-revalidate for runtimes ────────────────

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (!CACHED_HOSTS.includes(url.hostname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);

      // Background revalidation — cheap because the response is usually
      // immutable (versioned URLs). We never await it, so the page gets
      // its response as fast as possible.
      const networkPromise = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);

      // If we have a cache hit, return it immediately. Otherwise wait
      // for the network — first-visit slow path.
      return cached ?? networkPromise ?? new Response('', { status: 504 });
    })(),
  );
});
