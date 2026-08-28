// Service worker : network-first pour tout (coquille applicative ET données de cartes), avec
// repli sur le cache uniquement si hors-ligne. On a délibérément écarté le cache-first pour la
// coquille : ce site est encore en évolution active, et le cache-first laissait les visiteurs
// déjà installés bloqués sur d'anciennes versions du HTML/CSS/JS tant qu'on ne pensait pas à
// incrémenter CACHE_NAME à chaque déploiement — ce qui est arrivé plusieurs fois. Avec
// network-first, tant qu'il y a du réseau, le visiteur a toujours la dernière version ; le
// cache ne sert que de repli hors-ligne.
//
// CACHE_NAME reste à incrémenter (ex. "tcgp-shell-v3") après un déploiement qui casse quelque
// chose et nécessite de purger un cache déjà corrompu chez les visiteurs — plus une nécessité
// systématique à chaque changement mineur.
const CACHE_NAME = "tcgp-shell-v4";

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
  "js/share-image.js",
  "js/qrcode.js",
  "js/sync.js",
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
  event.respondWith(networkFirst(event.request));
});
