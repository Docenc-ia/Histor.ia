// Service Worker for Docenc.IA PWA - Instant Static Asset & Offline Caching
const CACHE_VERSION = 'v2.0';
const CACHE_PREFIX = 'docencia-pwa-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${CACHE_VERSION}`;
const STATIC_CODE_CACHE = `${CACHE_PREFIX}code-${CACHE_VERSION}`;
const STATIC_MEDIA_CACHE = `${CACHE_PREFIX}media-${CACHE_VERSION}`;

const ACTIVE_CACHES = [SHELL_CACHE, STATIC_CODE_CACHE, STATIC_MEDIA_CACHE];

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/pwa-icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/owl-head-realistic.jpg'
];

const NAVIGATION_TIMEOUT_MS = 1800;
const MAX_MEDIA_CACHE_ENTRIES = 120;
const MAX_CODE_CACHE_ENTRIES = 80;

/**
 * Limits the number of entries in a given cache (FIFO eviction)
 */
async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
      const excessCount = keys.length - maxEntries;
      await Promise.all(
        keys.slice(0, excessCount).map((request) => cache.delete(request))
      );
    }
  } catch (_) {
    // Ignore storage quota or trimming errors
  }
}

/**
 * Extracts local JS and CSS asset URLs from index.html markup so they can be pre-cached on install
 */
function extractStaticAssetsFromHtml(htmlText) {
  const urls = new Set();
  const attrRegex = /(?:src|href)=["'](\/[^"'>\s]+\.(?:js|css|mjs|svg|png|jpg|jpeg|webp|woff2?))["']/gi;
  let match;
  while ((match = attrRegex.exec(htmlText)) !== null) {
    if (match[1] && !match[1].startsWith('//')) {
      urls.add(match[1]);
    }
  }
  return Array.from(urls);
}

/**
 * Pre-caches a list of URLs resiliently so a single failed asset does not abort installation
 */
async function cacheUrlsResiliently(cacheName, urls) {
  const cache = await caches.open(cacheName);
  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);
        if (res && res.ok) {
          await cache.put(url, res);
        }
      } catch (_) {
        // Fallback without cache: 'reload' if network is flaky
        try {
          const fallbackRes = await fetch(url);
          if (fallbackRes && fallbackRes.ok) {
            await cache.put(url, fallbackRes);
          }
        } catch (__) {}
      }
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // 1. Pre-cache core app shell and icons
      await cacheUrlsResiliently(SHELL_CACHE, SHELL_ASSETS);

      // 2. Discover and pre-cache compiled CSS & JS bundles referenced in /index.html
      try {
        const shellCache = await caches.open(SHELL_CACHE);
        const indexResponse =
          (await shellCache.match('/index.html')) ||
          (await shellCache.match('/'));
        if (indexResponse) {
          const htmlText = await indexResponse.clone().text();
          const discoveredAssets = extractStaticAssetsFromHtml(htmlText);
          const codeAssets = discoveredAssets.filter((u) => /\.(js|mjs|css)$/i.test(u));
          const mediaAssets = discoveredAssets.filter((u) => !/\.(js|mjs|css)$/i.test(u));

          await Promise.all([
            codeAssets.length > 0
              ? cacheUrlsResiliently(STATIC_CODE_CACHE, codeAssets)
              : Promise.resolve(),
            mediaAssets.length > 0
              ? cacheUrlsResiliently(STATIC_MEDIA_CACHE, mediaAssets)
              : Promise.resolve()
          ]);
        }
      } catch (_) {}

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove outdated caches from previous versions
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (!ACTIVE_CACHES.includes(key)) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      );
      await self.clients.claim();
    })()
  );
});

/**
 * Listen for runtime asset warm-up or skipWaiting messages from the client
 */
self.addEventListener('message', (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data.type === 'WARM_STATIC_ASSETS' && Array.isArray(event.data.urls)) {
    event.waitUntil(
      (async () => {
        const validUrls = event.data.urls.filter(
          (u) => typeof u === 'string' && u.startsWith('/')
        );
        const codeUrls = validUrls.filter((u) => /\.(js|mjs|css)(\?.*)?$/i.test(u));
        const mediaUrls = validUrls.filter((u) => !/\.(js|mjs|css)(\?.*)?$/i.test(u));

        await Promise.all([
          codeUrls.length > 0
            ? cacheUrlsResiliently(STATIC_CODE_CACHE, codeUrls)
            : Promise.resolve(),
          mediaUrls.length > 0
            ? cacheUrlsResiliently(STATIC_MEDIA_CACHE, mediaUrls)
            : Promise.resolve()
        ]);
      })()
    );
  }
});

/**
 * Determines whether a request must bypass the Service Worker (Auth, Firestore, Classroom, dynamic APIs, video streams)
 */
function shouldBypassRequest(request, url) {
  if (request.method !== 'GET') return true;
  if (!url.protocol.startsWith('http')) return true;

  // Bypass range requests and large video files to prevent partial response (206) cache corruption
  if (request.headers.has('range') || /\.(mp4|webm|ogv)$/i.test(url.pathname)) {
    return true;
  }

  // Bypass Vite HMR / dev virtual modules if running in dev
  if (
    url.pathname.startsWith('/@vite') ||
    url.pathname.startsWith('/@react-refresh') ||
    url.pathname.startsWith('/node_modules/')
  ) {
    return true;
  }

  // Allow Google Fonts stylesheets and font binaries to be cached
  const isGoogleFonts =
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
  if (isGoogleFonts) {
    return false;
  }

  // Bypass all other Google APIs (Firestore, Classroom, Gmail, OAuth, GSI) and backend routes
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('gstatic.com') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/')
  ) {
    return true;
  }

  return false;
}

/**
 * Cache-First strategy: returns cached response immediately if present;
 * otherwise fetches from network, stores in cache, and returns response.
 */
async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (
      networkResponse &&
      (networkResponse.status === 200 || networkResponse.type === 'opaque')
    ) {
      cache.put(request, networkResponse.clone()).then(() => {
        if (maxEntries) trimCache(cacheName, maxEntries);
      }).catch(() => {});
    }
    return networkResponse;
  } catch (err) {
    const fallbackMatch = await caches.match(request, { ignoreSearch: true });
    if (fallbackMatch) return fallbackMatch;
    throw err;
  }
}

/**
 * Stale-While-Revalidate strategy: returns cached asset immediately for instant load,
 * while refreshing the cache in the background when network is available.
 */
async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  const networkPromise = fetch(request)
    .then((networkResponse) => {
      if (
        networkResponse &&
        (networkResponse.status === 200 || networkResponse.type === 'opaque')
      ) {
        cache.put(request, networkResponse.clone()).then(() => {
          if (maxEntries) trimCache(cacheName, maxEntries);
        }).catch(() => {});
      }
      return networkResponse;
    })
    .catch(() => cachedResponse);

  return cachedResponse || networkPromise;
}

/**
 * Navigation strategy:
 * - If App Shell (/index.html) is already cached, serve it with fast network race or immediate fallback
 *   so unstable connections never hang on a blank screen, while updating /index.html in background.
 */
async function handleNavigationRequest(request) {
  const shellCache = await caches.open(SHELL_CACHE);
  const cachedShell =
    (await shellCache.match('/index.html')) ||
    (await shellCache.match('/'));

  const fetchAndUpdateShell = fetch(request).then((response) => {
    if (response && response.status === 200) {
      shellCache.put('/index.html', response.clone()).catch(() => {});
    }
    return response;
  });

  // If we have a cached shell, race network against a short timeout so flaky connections load fast
  if (cachedShell) {
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve(cachedShell), NAVIGATION_TIMEOUT_MS);
    });
    return Promise.race([
      fetchAndUpdateShell.catch(() => cachedShell),
      timeoutPromise
    ]);
  }

  try {
    return await fetchAndUpdateShell;
  } catch (_) {
    return (
      (await caches.match('/index.html')) ||
      (await caches.match('/')) ||
      new Response('Sin conexión a internet. Por favor, volvé a intentar.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })
    );
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (shouldBypassRequest(request, url)) {
    return;
  }

  // 1. HTML Navigation requests -> Fast Network with Instant Cached App Shell Fallback
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // 2. Immutable Hashed Build Bundles (/assets/*.js, /assets/*.css) -> Cache-First for zero-latency startup
  const isHashedBuildCode =
    url.origin === self.location.origin &&
    url.pathname.startsWith('/assets/') &&
    /\.(js|mjs|css)$/i.test(url.pathname);

  if (isHashedBuildCode) {
    event.respondWith(cacheFirst(request, STATIC_CODE_CACHE, MAX_CODE_CACHE_ENTRIES));
    return;
  }

  // 3. Static JS & CSS scripts/stylesheets (including Google Fonts CSS) -> Stale-While-Revalidate
  const isCodeOrStyle =
    request.destination === 'script' ||
    request.destination === 'style' ||
    url.hostname === 'fonts.googleapis.com' ||
    /\.(js|mjs|css)$/i.test(url.pathname);

  if (isCodeOrStyle) {
    event.respondWith(
      staleWhileRevalidate(request, STATIC_CODE_CACHE, MAX_CODE_CACHE_ENTRIES)
    );
    return;
  }

  // 4. Icons, Images, and Fonts (SVG, PNG, JPG, WebP, ICO, WOFF2, Google Fonts binaries) -> Cache-First
  const isIconImageOrFont =
    request.destination === 'image' ||
    request.destination === 'font' ||
    url.hostname === 'fonts.gstatic.com' ||
    /\.(svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf)$/i.test(url.pathname);

  if (isIconImageOrFont) {
    // Check SHELL_CACHE first for precached PWA icons/logos, then STATIC_MEDIA_CACHE
    event.respondWith(
      caches.match(request).then((precached) => {
        if (precached) return precached;
        return cacheFirst(request, STATIC_MEDIA_CACHE, MAX_MEDIA_CACHE_ENTRIES);
      })
    );
    return;
  }

  // 5. Web App Manifest & other static JSON/config assets -> Stale-While-Revalidate in SHELL_CACHE
  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

