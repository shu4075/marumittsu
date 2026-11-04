// =====================================================
// sw.js … Service Worker（サービスワーカー）
// ページとインターネットの間に立つ「門番」のようなプログラム。
// ページがファイルを取りに行くたびに、ここを通る。
//   - 最初に開いたとき：アプリ本体のファイルを端末にしまっておく（キャッシュ）
//   - 次から：しまっておいたファイルをすぐ返す → 電波がなくても開ける
//   - 裏では最新版を取りに行き、取れたらしまい直す → 次に開いたとき新しくなる
// =====================================================


// ファイルを大きく変えたら、この番号を上げる（古いキャッシュが消える）
const CACHE_NAME = "marumittsu-v4";

// オフラインでも使いたいファイルの一覧
const APP_FILES = [
  "./",
  "index.html",
  "style.css",
  "marks.js",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet-rotate@0.2.8/dist/leaflet-rotate.js"
];


// ---------- インストール：アプリ本体をまとめてしまう ----------
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_FILES);
    })
  );
  self.skipWaiting(); // 待たずに新しい版を使い始める
});


// ---------- 有効化：古い版のキャッシュを片付ける ----------
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names
          .filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim(); // 開いているページもすぐ門番の管理下に入れる
});


// ---------- ファイルの取得：しまってある物を先に返す ----------
self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;

  // 地図タイル（OpenStreetMap）は門番を通さず、そのままネットへ。
  // 利用規約に配慮して、タイルはこちらでキャッシュしない
  if (request.url.indexOf("tile.openstreetmap.org") !== -1) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(request, { ignoreSearch: true }).then(function (cached) {
        // 裏で最新版を取りに行き、取れたらしまい直す
        const fromNetwork = fetch(request)
          .then(function (response) {
            if (response.ok && shouldCache(request.url)) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(function () { return cached; }); // 電波がなければ、しまってある物で

        // しまってあればすぐ返す。なければネットの結果を待つ
        return cached || fromNetwork;
      });
    })
  );
});

// しまっておくファイルかどうか
//   - APP_FILES に入っているファイル
//   - このサイトの中のファイル（images フォルダの写真など。一度見たものだけしまう）
//   - 見出しの明朝体（Google Fonts）
function shouldCache(url) {
  const isAppFile = APP_FILES.some(function (file) {
    return url === new URL(file, self.registration.scope).href;
  });
  const isOwnFile = url.indexOf(self.registration.scope) === 0;
  const isFont = url.indexOf("https://fonts.googleapis.com/") === 0 ||
                 url.indexOf("https://fonts.gstatic.com/") === 0;
  return isAppFile || isOwnFile || isFont;
}


// ---------- 通知をタップしたとき：アプリを前に出す ----------
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      if (list.length > 0) return list[0].focus();
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
