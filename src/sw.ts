/// <reference lib="webworker" />

const sw = self as any;

const CACHE_NAME = 'echosight-shell-v1';
const HEAVY_CACHE_NAME = 'echosight-models-v1';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

sw.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  sw.skipWaiting();
});

sw.addEventListener('activate', (event: any) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== HEAVY_CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  sw.clients.claim();
});

sw.addEventListener('fetch', (event: any) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// Handle progressive download requests from main thread
sw.addEventListener('message', (event: any) => {
  if (event.data && event.data.type === 'CACHE_HEAVY_ASSETS') {
    const assets = event.data.assets || [];
    event.waitUntil(
      caches.open(HEAVY_CACHE_NAME).then(async (cache) => {
        let loaded = 0;
        for (const url of assets) {
          try {
            const req = new Request(url);
            const res = await fetch(req);
            if (res.ok) {
              await cache.put(req, res);
              loaded++;
              event.source.postMessage({ type: 'DOWNLOAD_PROGRESS', loaded, total: assets.length });
            }
          } catch (e) {
            console.error('Failed to cache', url, e);
          }
        }
        event.source.postMessage({ type: 'DOWNLOAD_COMPLETE' });
      })
    );
  }
});

// Cache models on install
const MODEL_URLS = ['/models/det.onnx', '/models/rec.onnx', '/models/dict.txt'];
sw.addEventListener('install', (event: any) => {
  event.waitUntil(
    caches.open(HEAVY_CACHE_NAME).then(cache => {
      // Catch individual errors so one missing model doesn't fail the whole cache
      return Promise.allSettled(MODEL_URLS.map(url => cache.add(url)));
    })
  );
});
