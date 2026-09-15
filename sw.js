const CACHE_NAME = "blackshoes-control-v50";
const ASSETS = [
  "./",
  "./index.html",
  "./admin/index.html",
  "./catalogo/index.html",
  "./catalogo/producto.html",
  "./catalogo/config.js",
  "./catalogo/catalogo.css?v=5",
  "./catalogo/catalogo.js?v=9",
  "./styles.css?v=91",
  "./app.js?v=239",
  "./manifest.json?v=5",
  "./assets/blackshoes-header-logo.png",
  "./assets/blackshoes-logo.png",
  "./assets/blackshoes-icon-192.png",
  "./assets/blackshoes-icon-512.png",
  "./assets/blackshoes-apple-touch.png",
  "./assets/blackshoes-favicon-32.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
