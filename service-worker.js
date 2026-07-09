const CACHE_NAME = "bibah-bandhan-v4";

const urlsToCache = [
  "./",
  "./index.html",
  "./index.js",
  "./manifest.json",
  "./bibah-bandhan-logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./bibah-bandhan-poster.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
