/* OJ System Service Worker
 * 策略:
 * - 导航请求(HTML):network-first,失败回退缓存的 index.html(离线可用)
 * - 静态资源(/assets/ 等):stale-while-revalidate(先缓存后更新)
 * - API 请求(/api/):一律不缓存,保证数据实时性
 */
const CACHE_SHELL = 'oj-shell-v1';
const CACHE_ASSETS = 'oj-assets-v1';

self.addEventListener('install', () => {
  // 立即接管,不等旧 SW 关闭
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_SHELL && k !== CACHE_ASSETS).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // 跨域(如 CDN)不接管
  if (url.pathname.startsWith('/api/')) return;    // API 永不缓存
  if (url.pathname === '/__dev_info' || url.pathname === '/__seed') return;

  // 导航请求:network-first + 离线回退。
  // 始终 resolve 为合法 Response,绝不向 respondWith 传入 undefined（否则抛
  // "Failed to convert value to 'Response'"）。
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status < 500) {
            const copy = res.clone();
            caches.open(CACHE_SHELL).then((c) => c.put('/index.html', copy)).catch(() => {});
            return res;
          }
          return caches.match('/index.html').then((c) => c || Response.error());
        })
        .catch(() =>
          caches.match('/index.html').then((cached) => cached || Response.error())
        )
    );
    return;
  }

  // 静态资源:stale-while-revalidate。
  // 网络失败且无缓存时必须回退到 Response.error(),绝不能让 promise resolve 成
  // undefined（否则 respondWith 抛 "Failed to convert value to 'Response'"）。
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_ASSETS).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => cached);
        return network;
      }
      return fetch(req)
        .catch(() => Response.error());
    })
  );
});
