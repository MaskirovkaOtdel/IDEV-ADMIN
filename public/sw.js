/**
 * Service worker for IDEV : ADMIN.
 *
 * WHY THIS IS HAND-WRITTEN AND TINY
 * ---------------------------------
 * The app is a static bundle plus localStorage. There is no API, no data fetch, and
 * no auth. A PWA plugin would add a dependency, a precache manifest, and a
 * workbox runtime, to solve a problem this game does not have. A hundred lines of
 * this is enough, and every line is readable.
 *
 * WHAT MUST NOT HAPPEN
 * --------------------
 * The game's entire state lives in `localStorage` (`idev-admin:save`,
 * `idev-admin:settings`). A service worker cannot intercept localStorage — those
 * keys are never network requests — so progress cannot be evicted by cache
 * expiry, which is the usual way a PWA destroys an idle game's save. That
 * property is worth stating, because it is the reason this is low-risk.
 *
 * CACHING STRATEGY
 * ----------------
 *   navigations        network-first, falling back to the cached shell.
 *   hashed assets      cache-first. Vite content-hashes filenames, so a changed
 *                      file has a changed name and a cache hit is always correct.
 *
 * Network-first for the document specifically: a stale `index.html` would pin a
 * returning player to an old bundle indefinitely. With network-first they get the
 * new one the moment it is online, and still get the old one when it is not.
 *
 * NO PRECACHE MANIFEST
 * --------------------
 * Asset filenames are content-hashed at build time, so they cannot be listed
 * here. The shell is precached; the hashed bundle is cached on first fetch, which
 * happens during the very first page load. The consequence is stated plainly:
 * the game is offline-capable from the second visit onwards, not the first.
 *
 * The alternative — a build step injecting the real asset list — is what a
 * plugin exists to do. It is not worth a dependency for one static page, but it
 * is the thing to reach for if the asset count ever grows.
 */
const VERSION = 'v1';
const CACHE = `idev-admin-${VERSION}`;

/** The app shell. Relative, because the site is served from a sub-path. */
const SHELL = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload` bypasses the HTTP cache, so a shell precached from a stale
      // response would otherwise be baked in on first install.
      .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only GET is cacheable, and only what comes from our own origin. Anything else
  // goes straight to the network untouched.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // `only-if-cached` with a cross-origin mode throws if we respond from cache, and
  // the resulting rejection surfaces as a network error in the page. Letting these
  // through untouched is the documented way to avoid that.
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

/** Network, else the cached shell. Used for page loads. */
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    // A gateway error is not a page.
    //
    // Falling through on a non-ok status — rather than only when fetch THROWS —
    // is the whole point of this branch. Any proxy, CDN or captive portal in the
    // path answers a dead origin with 502/503/504 instead of a connection error,
    // and returning that verbatim hands the player a gateway error page INSTEAD OF
    // THE GAME, which is the exact outcome the cache exists to prevent. Verified:
    // with the origin server stopped, this returned 502 rather than the shell.
    throw new Error(`network responded ${response.status}`);
  } catch (error) {
    const cached = await matchIgnoringVary(cache, request);
    if (cached) return cached;
    // Offline and nothing cached under this exact URL — fall back to the shell so
    // the SPA still boots rather than showing the browser's offline page.
    const shell = await matchIgnoringVary(cache, './index.html');
    if (shell) return shell;
    throw error;
  }
}

/** Cache, else network, filling the cache on the way. Used for hashed assets. */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await matchIgnoringVary(cache, request);
  if (cached) return cached;

  const response = await fetch(request);
  // Range requests (media) and opaque cross-origin responses are not stored: the
  // first cannot be replayed correctly, the second is not readable.
  if (response.ok && response.type === 'basic') {
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Cache lookup that ignores `Vary`.
 *
 * `Vary: Origin` is sent by plenty of static servers (Vite's preview sends it, and
 * any CDN in front of GitHub Pages can add it). Cache matching honours `Vary` by
 * comparing request headers, so a response cached from a request without an
 * `Origin` header is invisible to a later request that has one — the entry sits in
 * the cache and can never be read again.
 *
 * Verified rather than assumed: with the origin stopped, the cached bundle was in
 * `caches.keys()` but `cache.match()` returned undefined for it, and only
 * `ignoreVary: true` found it.
 *
 * Ignoring it is safe here because every cached response is a same-origin `basic`
 * GET for an immutable, content-hashed asset or the app shell. The body of a
 * static file does not vary by `Origin`; the header is an artefact of the
 * server's CORS handling.
 */
function matchIgnoringVary(cache, request) {
  return cache.match(request, { ignoreVary: true });
}