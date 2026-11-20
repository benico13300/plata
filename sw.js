const CACHE_NAME = 'plata-shell-v6';
const APP_SHELL = ['./', './index.html', './styles.css', './accounts.css', './app.js', './accounts.js', './admin-categories.js', './manifest.webmanifest', './icon.svg', './logo.svg', './logo1.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Load the category manager after the existing account/admin code without
  // relying on a stale HTML shell that may be cached on installed phones.
  if (new URL(request.url).pathname.endsWith('/accounts.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).then(async response => {
      if (!response.ok) return response;
      const source = await response.text();
      const injection = `\n;(()=>{const s=document.createElement('script');s.src='./admin-categories.js';s.defer=false;document.head.append(s)})();\n`;
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');
      return new Response(source + injection, { status: response.status, statusText: response.statusText, headers });
    }).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
