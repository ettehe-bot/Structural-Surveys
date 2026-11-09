/* Service worker: precaches the whole app (code, basemap, fonts) so it runs with no signal.
   Bump CACHE_VERSION whenever any file changes; installed devices pick it up on next launch
   with a connection. */
const CACHE_VERSION = "ss-field-v1.8.0";
// Cached when present; the app works without them
const OPTIONAL = ["./data/overlay.geojson", "./data/basemap.geojson"];
// Utility network layers: the index lists one file per network; every listed file is cached too
const NETWORKS_INDEX = "./data/utilities/index.json";
// Skip the browser's HTTP cache, so a new version never saves an older copy of a file next to new ones
const fresh = (url) => new Request(url, { cache: "reload" });

async function precacheNetworks(cache) {
  try {
    const resp = await fetch(NETWORKS_INDEX, { cache: "no-store" });
    if (!resp.ok) return;
    await cache.put(NETWORKS_INDEX, resp.clone());
    const index = await resp.json();
    const files = (index.layers || []).map((n) => "./" + String(n.file || "").replace(/^\.?\//, "")).filter((f) => f.length > 2);
    await Promise.all(files.map((f) => cache.add(fresh(f)).catch(() => null)));
  } catch (e) { /* the app works without the networks */ }
}
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/config.js",
  "./js/db.js",
  "./js/map-style.js",
  "./js/export.js",
  "./js/surveyor-package.js",
  "./js/app.js",
  "./vendor/maplibre-gl.js",
  "./vendor/maplibre-gl.css",
  "./vendor/pmtiles.js",
  "./vendor/jszip.min.js",
  "./data/auh.pmtiles",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];
const FONT_RANGES = ["0-255", "256-511", "512-767", "768-1023", "1536-1791", "8192-8447", "65024-65279", "65280-65535"];
for (const font of ["Noto Sans Regular", "Noto Sans Medium"]) {
  for (const r of FONT_RANGES) PRECACHE.push(`./fonts/${encodeURIComponent(font)}/${r}.pbf`);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE.map(fresh))
        .then(() => Promise.all(OPTIONAL.map((u) => cache.add(fresh(u)).catch(() => null))))
        .then(() => precacheNetworks(cache)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => {
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("Offline and not cached", { status: 503, statusText: "Offline" });
      });
    })
  );
});
