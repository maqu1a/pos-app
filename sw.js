/* KaikeiPOS Service Worker
   アプリ本体（HTML/CSS/JS）はキャッシュから即表示し、裏で更新する。
   Supabase への通信（別オリジン）はキャッシュせず、常にネットワークへ。 */
const CACHE = "kaikeipos-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./vendor/supabase.js",
  "./js/app.js",
  "./js/auth.js",
  "./js/config.js",
  "./js/db.js",
  "./js/products.js",
  "./js/register.js",
  "./js/report.js",
  "./js/store.js",
  "./js/ui.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // Supabase などはそのまま通す

  // stale-while-revalidate（すぐ表示して裏で最新化）
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: false });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      return cached || (await network) || new Response("オフラインです", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    })
  );
});
