/* KaikeiPOS Service Worker
   アプリ本体（HTML/CSS/JS）はキャッシュから即表示し、裏で更新する。
   Supabase への通信（別オリジン）はキャッシュせず、常にネットワークへ。 */
const CACHE = "kaikeipos-v3";
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
  "./js/version.js",
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

  // ネットワーク優先（更新をすぐ反映）→ 失敗したらキャッシュ（オフライン時の表示用）
  // ※ キャッシュ優先にすると、更新しても1回目の読み込みで古いJSが動いてしまう
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        const cached = await cache.match(req);
        return (
          cached ||
          new Response("オフラインです", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
        );
      }
    })()
  );
});
