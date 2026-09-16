const CACHE_NAME = "blackshoes-control-v63";
const ASSETS = [
  "./",
  "./index.html",
  "./admin/index.html",
  "./catalogo",
  "./catalogo/producto.html",
  "./catalogo/config.js",
  "./catalogo/catalogo.css?v=7",
  "./catalogo/catalogo.js?v=11",
  "./styles.css?v=92",
  "./app.js?v=250",
  "./manifest.json?v=6",
  "./assets/blackshoes-header-logo.png",
  "./assets/blackshoes-logo.png",
  "./assets/blackshoes-icon-192.png?v=2",
  "./assets/blackshoes-icon-512.png?v=2",
  "./assets/blackshoes-apple-touch.png?v=2",
  "./assets/blackshoes-favicon-32.png?v=2",
  "./assets/blackshoes-social.png?v=2",
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
  const url = new URL(event.request.url);
  const isFreshAsset = event.request.mode === "navigate" || [".html", ".js", ".css"].some((suffix) => url.pathname.endsWith(suffix));
  if (isFreshAsset) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
