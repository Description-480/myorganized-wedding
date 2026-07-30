/*
 * Service worker — installability, and a graceful offline screen.
 *
 * Scope is deliberately narrow. A wedding's data lives behind an authenticated
 * Supabase session and changes constantly; caching any of it would risk showing
 * a helper yesterday's run of show on the day itself, which is worse than
 * showing them nothing. So:
 *
 *   - API calls and anything cross-origin: never touched.
 *   - Navigations: network first. The cached shell is a fallback for when the
 *     network is gone, never a substitute for it — cache-first would keep
 *     serving an old index.html after a deploy, pointing at asset filenames
 *     that no longer exist.
 *   - Hashed build assets: cache first, because the hash IS the version.
 *
 * Bump CACHE_VERSION on any change to this file.
 */
const CACHE_VERSION = "v2";
const SHELL_CACHE = `mow-shell-${CACHE_VERSION}`;
const ASSET_CACHE = `mow-assets-${CACHE_VERSION}`;

const SHELL_URL = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(SHELL_URL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Someone else's server (Supabase, Google, Stripe) is not ours to cache.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      // `cache: "reload"` matters more than it looks. A plain fetch() still
      // consults the browser's HTTP cache, and GitHub Pages serves index.html
      // with a max-age, so "network first" would happily hand back HTML from
      // ten minutes ago — pointing at the PREVIOUS build's hashed bundle, which
      // this service worker has helpfully cached and will serve. The result is
      // users pinned to old code well after a deploy. Ask for the shell fresh.
      fetch(request.url, { cache: "reload", credentials: "same-origin" })
        .then((response) => {
          // Keep the shell fresh so the offline fallback isn't ancient.
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL))
    );
    return;
  }

  // Immutable, content-hashed build output.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});
