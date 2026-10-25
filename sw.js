// Service worker: сохраняет приложение на телефоне, чтобы оно работало без интернета.
// При изменении файлов приложения увеличивайте номер версии.
const VERSION = 'v14'; // держать равным APP_VERSION в js/app.js
const SHELL = `ft-shell-${VERSION}`;
const ASSETS = 'ft-assets-v1'; // большие файлы (модель, wasm) — меняются редко

const SHELL_FILES = [
  './',
  'index.html',
  'css/style.css',
  'css/fonts.css',
  'fonts/fira-800-normal-cyrillic.woff2',
  'fonts/fira-800-normal-latin.woff2',
  'fonts/fira-900-italic-cyrillic.woff2',
  'fonts/fira-900-italic-latin.woff2',
  'fonts/onest-400-700-normal-cyrillic.woff2',
  'fonts/onest-400-700-normal-latin.woff2',
  'js/app.js',
  'js/achievements.js',
  'js/goal.js',
  'js/profile.js',
  'js/cloud.js',
  'js/counter.js',
  'js/db.js',
  'js/history.js',
  'js/device.js',
  'js/exercises.js',
  'js/pose.js',
  'js/settings.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'assets/keepawake.mp4',
];

const ASSET_FILES = [
  'vendor/mediapipe/vision_bundle.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.js',
  'vendor/mediapipe/wasm/vision_wasm_internal.wasm',
  'models/pose_landmarker_full.task',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await (await caches.open(SHELL)).addAll(SHELL_FILES);
    const assets = await caches.open(ASSETS);
    for (const url of ASSET_FILES) {
      if (!(await assets.match(url))) await assets.add(url);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS]);
    for (const key of await caches.keys()) {
      if (!keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const isAsset = (url) => /\/(vendor|models)\//.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isAsset(url)) {
    // Большие файлы: сначала из памяти телефона, если нет — скачать и сохранить.
    event.respondWith(cacheFirst(request, ASSETS));
  } else {
    // Файлы приложения: сначала свежие из сети (чтобы видеть обновления),
    // без сети — сохранённые.
    event.respondWith(networkFirst(request, SHELL));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetchWithTimeout(request, 4000);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const index = await cache.match('index.html');
      if (index) return index;
    }
    throw err;
  }
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    // no-cache: всегда сверяться с сервером, а не брать из кэша браузера
    // (GitHub Pages разрешает браузеру хранить файлы до 10 минут).
    fetch(request.url, { cache: 'no-cache' }).then(
      (r) => { clearTimeout(timer); resolve(r); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
