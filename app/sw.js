// sw.js — makes Cardfile work offline.
// App files: network first (so updates show up), falling back to the cache.
// Text-reader engine (vendor/): cache first, since it never changes.
// Bump VERSION when you change the app to clear old caches.

const VERSION = 'v2';
const SHELL = `cardfile-shell-${VERSION}`;
const ENGINE = `cardfile-engine-${VERSION}`;

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/image.js', 'js/ocr.js', 'js/parser.js', 'js/vcard.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const ENGINE_FILES = [
  'vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tesseract/lang/eng.traineddata.gz',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(SHELL_FILES);
    // engine core is picked per device at runtime, so only the shared files are pre-cached
    await (await caches.open(ENGINE)).addAll(ENGINE_FILES).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, ENGINE, 'cardfile-vcard'].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // "Add to Contacts": the app puts the contact file in this cache, then opens it
  if (new URL(req.url).pathname.endsWith('/contact.vcf')) {
    event.respondWith((async () => {
      const hit = await (await caches.open('cardfile-vcard')).match(req, { ignoreSearch: true });
      return hit ? new Response(hit.body, { headers: { 'Content-Type': 'text/vcard; charset=utf-8', 'Content-Disposition': 'inline; filename="contact.vcf"' } })
        : new Response('Contact not found', { status: 404 });
    })());
    return;
  }

  if (req.url.includes('/vendor/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ENGINE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html'));
    }
  })());
});
