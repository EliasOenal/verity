const assets = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "/vera.svg",
  "/unknownuser.svg",
  "/bootstrap.min.css",
  "/bootstrap-icons.min.css",
  "/bootstrap.bundle.min.js",
  "/fonts/bootstrap-icons.woff",
  "/frontend.js",
  "/verityUI.js",
]

caches.open("verityCache").then(cache => {
  cache.addAll(assets)
});

self.addEventListener("install", installEvent => {
  installEvent.waitUntil(
    caches.open("verityCache").then(cache => {
      cache.addAll(assets)
    })
  )
});

self.addEventListener("fetch", fetchEvent => {
  fetchEvent.respondWith(
    caches.match(fetchEvent.request).then(res => {
      return res || fetch(fetchEvent.request)
    })
  )
});
