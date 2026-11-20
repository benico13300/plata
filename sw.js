const CACHE_NAME = 'plata-shell-v8';
const APP_SHELL = ['./', './index.html', './styles.css', './accounts.css', './app.js', './accounts.js', './admin-categories.js', './branding.js', './manifest.webmanifest', './icon.svg', './logo.svg', './logo1.svg'];

function injectBranding(response) {
  if (!response || !response.ok) return response;
  return response.text().then(html => {
    const script = '<script defer src="./branding.js?v=8"></script>';
    if (!html.includes('branding.js')) html = html.replace(/<\/body>/i, `${script}</body>`);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('cache-control', 'no-store');
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  });
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  const isHtml = request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/plata/');
  if (isHtml) {
    event.respondWith(fetch(request, { cache: 'no-store' }).then(injectBranding).catch(() => caches.match(request).then(injectBranding)));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => Response.error())));
});
