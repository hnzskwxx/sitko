// Service worker Sítka. Záměrně necachuje aplikaci ani data z API: personalista má vždy
// vidět aktuální stav a osobní údaje kandidátů nemají zůstávat v mezipaměti zařízení.
// Jen při výpadku připojení ukáže offline stránku místo chyby prohlížeče.
const CACHE = 'sitko-offline-v1';
const OFFLINE = ['/offline.html', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
