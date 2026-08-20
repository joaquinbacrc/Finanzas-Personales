// Service Worker: cache SOLO de assets estáticos. Nunca toca navegaciones ni /api/.
//
// Historia (no romper esto): la v1 precacheaba '/', '/index.html' y '/login.html'.
// Esas tres son navegaciones y la app tiene auth, asi que el worker les responde con
// un redirect a /login. Un SW no puede contestar una navegacion con una respuesta
// redirected sacada del cache -> Chrome corta con ERR_FAILED y la app parece caida
// cuando en realidad esta perfecta. Por eso ahora:
//   1) las navegaciones NO se interceptan (van siempre a la red),
//   2) nunca se cachea ni se devuelve una respuesta redirected u opaca.
const CACHE = 'finanzas-v3';

// Solo assets que NO dependen de la sesion y no son navegables.
const ASSETS = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/favicon.ico'];

// Una respuesta sirve para cachear solo si es propia, 200 y no redirected.
function esCacheable(resp) {
  return resp && resp.ok && resp.type === 'basic' && !resp.redirected && resp.status === 200;
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Borra TODA cache que no sea la actual: asi un SW nuevo limpia solo el veneno
  // que dejo una version anterior, sin que el usuario tenga que hacer nada.
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Navegaciones (abrir la app, /login, refresh): siempre red, jamas cache.
  if (req.mode === 'navigate' || req.destination === 'document') return;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // datos: siempre red

  // Assets: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then((cached) => {
      const red = fetch(req)
        .then((resp) => {
          if (esCacheable(resp)) {
            const clone = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          }
          return resp;
        })
        .catch(() => cached);
      return cached || red;
    })
  );
});
