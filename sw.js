/* PWA Service Worker：手机版（GitHub Pages）离线可用。
 * 电脑版页面不注册 SW（index.html 只在 https 下注册）。
 * 策略：静态资源（下方列表）缓存优先、后台更新；其余同源 GET 先网络后缓存兜底；
 * 非同源（GLM API）与非 GET（/api 写请求）一律不缓存。 */
const CACHE = "schedule-buddy-v14";
const PRECACHE = [
  "./",
  "index.html",
  "manifest.json",
  "static/style.css",
  "static/main.js",
  "static/api.js",
  "static/local/storage.js",
  "static/local/ai.js",
  "static/icons/icon-192.png",
  "static/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
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
  if (url.origin !== location.origin) return;  // GLM API 直连不缓存

  const precached = PRECACHE.some((p) => url.pathname.endsWith(p.replace("./", "")) && p !== "./")
    || url.pathname === new URL("./", location.href).pathname;

  if (precached) {
    // 缓存优先 + 后台更新（stale-while-revalidate）
    e.respondWith(
      caches.match(req).then((hit) => {
        const fetching = fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => hit);
        return hit || fetching;
      })
    );
  } else {
    // 先网络后缓存兜底（离线时至少页面外壳可用）
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
  }
});
