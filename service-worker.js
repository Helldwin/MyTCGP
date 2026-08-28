// Service worker : coquille applicative en cache (cache-first) pour fonctionner hors-ligne,
// données de cartes en network-first (fraîcheur si en ligne, repli sur le cache sinon).
//
// IMPORTANT : incrémenter CACHE_NAME (ex. "tcgp-shell-v2") à chaque déploiement qui change
// le HTML/CSS/JS, sinon les visiteurs déjà installés continueront de voir l'ancienne version
// tant que le cache n'est pas invalidé (voir README).
const CACHE_NAME = "tcgp-shell-v1";

const APP_SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "manifest.webmanifest",
  "js/api.js",
  "js/collection.js",
  "js/theme.js",
  "js/toast.js",
  "js/ui-state.js",
  "js/render.js",
  "js/app.js",
  "js/sw-register.js",
  "icons/icon.svg",
  "icons/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const DATA_HOSTS = new Set(["cdn.jsdelivr.net"]);

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(CACHE_NAME);
  cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  if (DATA_HOSTS.has(url.hostname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(event.request));
  }
});
