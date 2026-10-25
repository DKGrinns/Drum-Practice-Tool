// sw.js — service worker for offline use.
//
// On install it downloads every file the app needs into a versioned cache.
// Requests are then answered from the cache first (so the app opens
// instantly and works with no connection), falling back to the network.
//
// When you change any app file, bump CACHE_VERSION so installed copies pick
// up the new files: the new worker installs in the background and takes
// over on the next launch.

const CACHE_VERSION = 'v1';
const CACHE = 'groove-trainer-' + CACHE_VERSION;

const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/engine.js',
  'js/sequencer.js',
  'js/synth.js',
  'js/patterns.js',
  'js/grooves.js',
  'js/storage.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('groove-trainer-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Page navigations always get the cached app shell.
    const cached = await cache.match(req, { ignoreSearch: true }) ||
      (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
