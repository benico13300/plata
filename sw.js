// Plata — service worker.
// Windows (enregistré avec ?offline=1) : l'application s'ouvre sans réseau grâce au cache de l'interface.
// Téléphone : aucun cache, l'application exige une connexion (les données ne sont pas conservées sur l'appareil).
const OFFLINE = new URL(self.location.href).searchParams.get('offline') === '1';
const CACHE_NAME = 'plata-shell-v14';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './cloud.bundle.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './logo.svg'];

self.addEventListener('install', event => {
  event.waitUntil((OFFLINE ? caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)) : Promise.resolve()).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => !OFFLINE || key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

// Réseau d'abord (toujours la dernière version), cache en secours hors ligne.
self.addEventListener('fetch', event => {
  if (!OFFLINE) return;
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then(cached => cached || (request.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
