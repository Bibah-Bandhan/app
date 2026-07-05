const CACHE_NAME = "bibah-bandhan-v3";

const urlsToCache = [
  "./",
  "./index.html",
  "./index.js",
  "./bibah-bandhan-logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./bibah-bandhan-poster.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});

