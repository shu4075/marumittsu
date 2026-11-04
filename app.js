// =====================================================
// app.js … まるみっつーの「動き」を担当するプログラム
// 大まかな流れ：
//   1. 地図を表示して、マークを番号入りの丸で描く
//   2. 自分の位置を受け取る（デモ＝地図タップ / GPS＝本物の位置）
//   3. 近くのマークに入ったら、カードとお知らせを出す
//   4. 見つけたら写真を撮る → 写っていたらスタンプ
// （さんぽガイドの隠れミッキー探しの部分を、1つのアプリとして独立させたもの）
// =====================================================


// ---------- 設定 ----------
const PARK_CENTER = [35.6329, 139.8804]; // ランドの中心
const SEA_CENTER = [35.6262, 139.8850];  // シーの中心
// 地図の向き：画面の上に来る方角（北=0、東=90…）。入口が下になるように回す
const LAND_BEARING = 156;
const SEA_BEARING = 245;
const START_ZOOM = 17;
const LEAVE_MARGIN = 10;  // 範囲から「出た」と判定するための余裕（m）
const RANGE_EXTRA = 20;   // お知らせが来る範囲は、マークの radius より20m広くする（目の前の通路くらい）
const PARK_LABEL = { land: "ランド", sea: "シー" };


// ---------- 端末に覚えておく設定（localStorage） ----------
// 保存できない環境（プライベートブラウズなど）でも動くように、失敗しても止めない
function loadSetting(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* 保存できなくても続行 */ }
}


// ---------- 番号：ランドとシーで、それぞれ 1 から数える ----------
(function () {
  const count = { land: 0, sea: 0 };
  MARKS.forEach(function (m) { m.num = ++count[m.park]; });
})();
function displayName(m) {
  return m.num + "　" + m.name;
}


// ---------- 見つけた（スタンプを押した）マーク ----------
const found = (function () {
  try { return new Set(JSON.parse(loadSetting("found") || "[]")); } catch (e) { return new Set(); }
})();
function saveFound() {
  saveSetting("found", JSON.stringify(Array.from(found)));
}


// ---------- 1. 地図を表示 ----------
const map = L.map("map", {
  zoomControl: false,
  rotate: true,          // 地図の回転を使う（leaflet-rotate）
  touchRotate: false,    // 2本指でうっかり回ってしまわないようにする
  rotateControl: false
}).setView(PARK_CENTER, START_ZOOM);

function setMapBearing(bearing) {
  if (typeof map.setBearing !== "function") return; // 回転の部品が読み込めなかったときは回さない
  map.setBearing(-bearing);
  document.getElementById("compass").style.transform = "rotate(" + (-bearing) + "deg)";
}
setMapBearing(LAND_BEARING);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// 地図の印：番号を書いた丸。スタンプを押したもの（got）は朱色で塗る
function pinIcon(m) {
  return L.divIcon({
    className: "pin pin-hidden" + (found.has(m.id) ? " got" : ""),
    html: "<span>" + m.num + "</span>",
    iconSize: [24, 24]
  });
}

// 引いて見ているときは印を小さくして、地図を見やすくする
function applyZoomClass() {
  const z = map.getZoom();
  const el = map.getContainer();
  el.classList.toggle("zoom-far", z < 17);
  el.classList.toggle("zoom-mid", z >= 17 && z < 18);
}
map.on("zoomend", applyZoomClass);
applyZoomClass();

const pins = {}; // マークID → 地図の印
MARKS.forEach(function (m) {
  pins[m.id] = L.marker([m.lat, m.lng], { icon: pinIcon(m) })
    .on("click", function () { showCard(m); });
});


// ---------- ランドとシーの切り替え ----------
const btnLand = document.getElementById("park-land");
const btnSea = document.getElementById("park-sea");
let currentPark = loadSetting("park") === "sea" ? "sea" : "land";

function showPark(park, move) {
  currentPark = park;
  saveSetting("park", park);
  if (move) map.setView(park === "sea" ? SEA_CENTER : PARK_CENTER, START_ZOOM);
  setMapBearing(park === "sea" ? SEA_BEARING : LAND_BEARING);
  btnLand.setAttribute("aria-pressed", park === "land" ? "true" : "false");
  btnSea.setAttribute("aria-pressed", park === "sea" ? "true" : "false");
  applyFilter();
  renderList();
}
btnLand.addEventListener("click", function () { showPark("land", true); });
btnSea.addEventListener("click", function () { showPark("sea", true); });


// ---------- 地図に出すマーク：すべて／まだ／見つけた ----------
let viewFilter = ["all", "todo", "done"].indexOf(loadSetting("filter")) >= 0 ? loadSetting("filter") : "all";

function isShown(m) {
  if (viewFilter === "todo") return !found.has(m.id);
  if (viewFilter === "done") return found.has(m.id);
  return true;
}
function applyFilter() {
  MARKS.forEach(function (m) {
    if (isShown(m)) pins[m.id].addTo(map); else pins[m.id].remove();
  });
  document.querySelectorAll("#filter button").forEach(function (b) {
    b.setAttribute("aria-pressed", b.dataset.filter === viewFilter ? "true" : "false");
  });
}
document.querySelectorAll("#filter button").forEach(function (b) {
  b.addEventListener("click", function () {
    viewFilter = b.dataset.filter;
    saveSetting("filter", viewFilter);
    applyFilter();
  });
});


// ---------- 距離の計算（ハバーサイン公式） ----------
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = function (deg) { return deg * Math.PI / 180; };
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function formatDistance(m) {
  if (m < 1000) return "約" + Math.round(m) + "m";
  return "約" + (m / 1000).toFixed(1) + "km";
}


// ---------- 位置を受け取って、近くのマークを判定 ----------
let meMarker = null;
let meAccuracy = null;
let lastPos = null;
const inside = new Set(); // 今、範囲の中にいるマーク（同じお知らせを何度も出さないため）

function updatePosition(lat, lng, accuracy) {
  lastPos = { lat: lat, lng: lng, accuracy: accuracy };

  if (!meMarker) {
    meAccuracy = L.circle([lat, lng], { radius: accuracy, color: "#2d8cff", weight: 1, fillOpacity: 0.1 }).addTo(map);
    meMarker = L.circleMarker([lat, lng], { radius: 8, color: "#fff", weight: 3, fillColor: "#2d8cff", fillOpacity: 1 }).addTo(map);
  } else {
    meMarker.setLatLng([lat, lng]);
    meAccuracy.setLatLng([lat, lng]).setRadius(accuracy);
  }

  // まだ見つけていないマークだけを判定する（見つけたものでお知らせが鳴らないように）
  let nearest = null;
  let nearestDist = Infinity;
  const entered = [];
  MARKS.filter(function (m) { return !found.has(m.id); }).forEach(function (m) {
    const d = distanceMeters(lat, lng, m.lat, m.lng);
    if (d < nearestDist) { nearest = m; nearestDist = d; }
    const range = m.radius + RANGE_EXTRA;
    if (d <= range && !inside.has(m.id)) {
      inside.add(m.id);
      entered.push({ m: m, d: d });
    } else if (d > range + LEAVE_MARGIN) {
      inside.delete(m.id);
    }
  });

  if (entered.length > 0) {
    entered.sort(function (a, b) { return a.d - b.d; });
    showCard(entered[0].m);
    try { if (navigator.vibrate) navigator.vibrate(200); } catch (e) { /* 振動できなくても続行 */ }
    if (mode === "gps") notifyNearby(entered[0].m, entered.length);
  }

  if (nearest) {
    setStatus("いちばん近いマーク：" + PARK_LABEL[nearest.park] + " " + displayName(nearest) + "（" + formatDistance(nearestDist) + "）");
  }
  renderList();
  if (following) map.panTo([lat, lng]);
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}


// ---------- 下の引き出し（ボトムシート） ----------
// 大きさは3段階：peek（少しだけ）→ half（半分）→ full（ほぼ全画面）
// 引き出しの高さは固定で、style.css の transform で「下にずらす量」を変えている
const sheet = document.getElementById("sheet");
const sheetBody = document.getElementById("sheet-body");
const sheetHandle = document.getElementById("sheet-handle");
const SHEET_STATES = ["peek", "half", "full"];

function setSheet(state) {
  sheet.dataset.state = state;
  sheet.style.transform = "";
  sheetHandle.setAttribute("aria-label", state === "full" ? "引き出しを小さくする" : "引き出しを広げる");
}
function peekHeight() {
  return sheetHandle.offsetHeight + document.querySelector(".sheet-peek").offsetHeight;
}
// 実際の高さを測って --peek に入れる（地図の下端と現在地ボタンの位置がこれで決まる）
function fitPeek() {
  document.documentElement.style.setProperty("--peek", peekHeight() + "px");
  map.invalidateSize();
}
window.addEventListener("resize", fitPeek);

// つまみと上の部分を上下にドラッグできるようにする
(function () {
  let startY = 0;
  let startOffset = 0;
  let moved = false;
  let dragging = false;

  function onDown(e) {
    if (e.target.closest("button") && !sheetHandle.contains(e.target)) return; // ボタンは普通に押せるようにする
    dragging = true;
    moved = false;
    startY = e.clientY;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    startOffset = new DOMMatrix(getComputedStyle(sheet).transform).m42;
  }
  function onMove(e) {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dy) < 6) return; // 少し動いただけならタップ扱い
    if (!moved) { moved = true; sheet.classList.add("dragging"); }
    const maxOffset = sheet.offsetHeight - peekHeight();
    const y = Math.min(Math.max(startOffset + dy, 0), maxOffset);
    sheet.style.transform = "translateY(" + y + "px)";
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove("dragging");
    if (!moved) return;
    // 離した位置に一番近い段階を選ぶ。速くはじいたら、その向きに1段階進める
    const y = new DOMMatrix(getComputedStyle(sheet).transform).m42;
    const h = sheet.offsetHeight;
    const offsets = { full: 0, half: h * 0.45, peek: h - peekHeight() };
    const dy = e.clientY - startY;
    let best = "peek";
    SHEET_STATES.forEach(function (s) {
      if (Math.abs(offsets[s] - y) < Math.abs(offsets[best] - y)) best = s;
    });
    const before = sheet.dataset.state;
    if (best === before && Math.abs(dy) > 40) {
      const i = SHEET_STATES.indexOf(before) + (dy < 0 ? 1 : -1);
      best = SHEET_STATES[Math.min(Math.max(i, 0), 2)];
    }
    setSheet(best);
  }
  [sheetHandle, document.querySelector(".sheet-peek")].forEach(function (el) {
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  });
  sheetHandle.addEventListener("click", function () {
    if (moved) return;
    const s = sheet.dataset.state;
    setSheet(s === "peek" ? "half" : s === "half" ? "full" : "peek");
  });
})();


// ---------- 一覧とスタンプ帳 ----------
const listEl = document.getElementById("list");
let sortMode = loadSetting("sort") === "near" ? "near" : "number";

function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function renderList() {
  // 今見ているパークのマークだけ
  const items = MARKS
    .filter(function (m) { return m.park === currentPark; })
    .map(function (m) {
      return { m: m, d: lastPos ? distanceMeters(lastPos.lat, lastPos.lng, m.lat, m.lng) : null };
    });
  const got = items.filter(function (it) { return found.has(it.m.id); }).length;

  document.getElementById("peek-count").textContent = PARK_LABEL[currentPark] + " " + got + "/" + items.length;
  document.getElementById("list-title").textContent = PARK_LABEL[currentPark] + "のマーク";
  renderStampCard(items, got);

  // 並べ方
  document.querySelectorAll("#sort button").forEach(function (b) {
    b.setAttribute("aria-pressed", b.dataset.sort === sortMode ? "true" : "false");
  });
  if (sortMode === "near" && lastPos) {
    items.sort(function (a, b) { return a.d - b.d; });
  } else {
    items.sort(function (a, b) { return a.m.num - b.m.num; });
  }
  let note;
  if (sortMode === "near" && !lastPos) note = "現在地がわかると近い順に並びます（メニューの「GPSで探しに行く」）";
  else if (sortMode === "near") note = "近い順に並んでいます";
  else note = "番号順に並んでいます";
  document.getElementById("list-note").textContent = note + "。タップするとヒントが読めます";

  const ul = document.getElementById("list-items");
  ul.innerHTML = "";
  items.forEach(function (it) {
    const isGot = found.has(it.m.id);
    const btn = makeEl("button", "list-item" + (isGot ? " got" : ""));
    const name = makeEl("span", "list-name", it.m.name);
    name.appendChild(makeEl("span", "list-area", it.m.area));
    btn.append(makeEl("span", "list-num", String(it.m.num)), name);
    if (isGot) btn.append(makeEl("span", "list-found", "発見済み"));
    btn.append(makeEl("span", "list-dist", it.d === null ? "" : formatDistance(it.d)));
    btn.addEventListener("click", function () { showCard(it.m); });
    const li = document.createElement("li");
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// スタンプ帳：番号の丸が並び、見つけたものにスタンプが押される。丸をタップするとカードが開く
// ふだんは閉じておき（一覧をすぐ見られるように）、見出しをタップすると開く。開いたかどうかは覚えておく
let stampsOpen = loadSetting("stampsOpen") === "yes";

function renderStampCard(items, got) {
  const box = document.getElementById("stamp-card");
  box.innerHTML = "";
  const head = makeEl("button", "stamp-toggle", PARK_LABEL[currentPark] + "のスタンプ帳　" + got + " / " + items.length);
  head.setAttribute("aria-expanded", stampsOpen ? "true" : "false");
  head.addEventListener("click", function () {
    stampsOpen = !stampsOpen;
    saveSetting("stampsOpen", stampsOpen ? "yes" : "no");
    renderList();
  });
  box.appendChild(head);
  if (!stampsOpen) return;
  const grid = makeEl("div", "stamp-grid");
  items.slice().sort(function (a, b) { return a.m.num - b.m.num; }).forEach(function (it) {
    const isGot = found.has(it.m.id);
    const b = makeEl("button", "stamp" + (isGot ? " got" : ""), String(it.m.num));
    b.setAttribute("aria-label", displayName(it.m) + (isGot ? "（発見済み）" : ""));
    b.addEventListener("click", function () { showCard(it.m); });
    grid.appendChild(b);
  });
  box.appendChild(grid);
}

document.querySelectorAll("#sort button").forEach(function (b) {
  b.addEventListener("click", function () {
    sortMode = b.dataset.sort;
    saveSetting("sort", sortMode);
    renderList();
  });
});


// ---------- マークのカード ----------
const card = document.getElementById("card");
const peekBtn = document.getElementById("card-peek");
let current = null;

function showCard(m) {
  current = m;
  // 別のパークのマークを開いたら、パークも切り替える
  if (m.park !== currentPark) {
    showPark(m.park, false);
    map.setView([m.lat, m.lng], START_ZOOM);
  }
  const isGot = found.has(m.id);

  document.getElementById("card-area").textContent = PARK_LABEL[m.park] + "・" + m.area;
  const ver = document.getElementById("card-verified");
  ver.textContent = m.verified ? "確認済み" : "未確認";
  ver.classList.toggle("unverified", !m.verified);
  document.getElementById("card-title").textContent = displayName(m);

  // 見つけるまではヒント、見つけたら答え
  document.getElementById("card-label").textContent = isGot ? "答え" : "ヒント";
  document.getElementById("card-body").textContent = isGot ? m.body : m.hint;

  document.getElementById("card-actions").classList.toggle("hidden", isGot);
  peekBtn.classList.remove("hidden");
  compareEl.classList.add("hidden");
  showMyPhoto(m);

  listEl.classList.add("hidden");
  card.classList.remove("hidden");
  sheetBody.scrollTop = 0;
  if (sheet.dataset.state === "peek") setSheet("half");
}

function closeCard() {
  card.classList.add("hidden");
  listEl.classList.remove("hidden");
  renderList();
}
document.getElementById("card-close").addEventListener("click", closeCard);

// 答えだけ見る：本文を答えに入れかえるだけ。記録しないのでスタンプはつかない
peekBtn.addEventListener("click", function () {
  if (!current) return;
  document.getElementById("card-label").textContent = "答え（スタンプはまだ）";
  document.getElementById("card-body").textContent = current.body;
  peekBtn.classList.add("hidden");
});

// スタンプを押す（写真を撮って「写っている！」を押したときだけ）
function markFound(m) {
  found.add(m.id);
  saveFound();
  pins[m.id].setIcon(pinIcon(m)); // 地図の丸を朱色に
  inside.delete(m.id);
  applyFilter();
  showCard(m);
  renderList();
}


// ---------- 写真で答え合わせ ----------
// 流れ：カメラで撮る → 撮った写真と正解（写真か、答えの文章）を並べる
//       → 自分で「写っている！」を押す → 写真を保存して、スタンプを押す
const photoInput = document.getElementById("photo-input");
const compareEl = document.getElementById("compare");
let pendingPhoto = null;

document.getElementById("card-photo").addEventListener("click", openCamera);
document.getElementById("compare-retry").addEventListener("click", openCamera);

function handlePhoto(blob) {
  if (!current) return;
  pendingPhoto = blob;
  setImageFromBlob(document.getElementById("compare-mine"), blob);
  const hasAnswerImage = !!current.answerImage;
  document.getElementById("compare-answer-figure").classList.toggle("hidden", !hasAnswerImage);
  if (hasAnswerImage) document.getElementById("compare-answer").src = current.answerImage;
  const answerText = document.getElementById("compare-answer-text");
  answerText.textContent = "答え：" + current.body;
  answerText.classList.toggle("hidden", hasAnswerImage);
  compareEl.classList.toggle("single", !hasAnswerImage);
  document.getElementById("card-actions").classList.add("hidden");
  compareEl.classList.remove("hidden");
}

document.getElementById("compare-yes").addEventListener("click", function () {
  if (!current || !pendingPhoto) return;
  const m = current;
  savePhoto(m.id, pendingPhoto).finally(function () {
    pendingPhoto = null;
    markFound(m);
  });
});

// 予備：アプリ内カメラが使えないときは、端末のカメラアプリで撮る
function openSystemCamera() {
  photoInput.value = "";
  photoInput.click();
}
photoInput.addEventListener("change", function () {
  const file = photoInput.files[0];
  if (!file) return;
  shrinkPhoto(file, 1000).then(handlePhoto);
});

// アプリ内カメラ：getUserMedia でカメラの映像を <video> に流し、シャッターで1コマを写真にする
const cameraEl = document.getElementById("camera");
const cameraVideo = document.getElementById("camera-video");
let cameraStream = null;

function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    openSystemCamera();
    return;
  }
  navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false
  }).then(function (stream) {
    cameraStream = stream;
    stream.getVideoTracks().forEach(function (track) {
      track.addEventListener("ended", closeCamera);
    });
    cameraVideo.srcObject = stream;
    cameraEl.classList.remove("hidden");
    return cameraVideo.play();
  }).catch(function () {
    closeCamera();
    openSystemCamera();
  });
}
function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(function (track) { track.stop(); });
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
  cameraEl.classList.add("hidden");
}
document.getElementById("camera-shutter").addEventListener("click", function () {
  const w = cameraVideo.videoWidth;
  const h = cameraVideo.videoHeight;
  if (!w || !h) return;
  const scale = Math.min(1, 1000 / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
  closeCamera();
  canvas.toBlob(function (blob) { if (blob) handlePhoto(blob); }, "image/jpeg", 0.8);
});
document.getElementById("camera-cancel").addEventListener("click", closeCamera);
document.getElementById("camera-album").addEventListener("click", function () {
  closeCamera();
  openSystemCamera();
});

function shrinkPhoto(file, maxSize) {
  return new Promise(function (resolve) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) { resolve(blob || file); }, "image/jpeg", 0.8);
    };
    img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
function setImageFromBlob(imgEl, blob) {
  if (imgEl.dataset.url) URL.revokeObjectURL(imgEl.dataset.url);
  imgEl.dataset.url = URL.createObjectURL(blob);
  imgEl.src = imgEl.dataset.url;
}
function showMyPhoto(m) {
  const fig = document.getElementById("card-myphoto");
  fig.classList.add("hidden");
  if (!found.has(m.id)) return;
  loadPhoto(m.id).then(function (blob) {
    if (!blob || current !== m) return;
    setImageFromBlob(document.getElementById("card-myphoto-img"), blob);
    fig.classList.remove("hidden");
  });
}

// 撮った写真の保存：大きいので localStorage ではなく、端末内のデータベース IndexedDB に入れる
function openPhotoDB() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open("marumittsu", 1);
    req.onupgradeneeded = function () { req.result.createObjectStore("photos"); };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
function savePhoto(id, blob) {
  return openPhotoDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction("photos", "readwrite");
      tx.objectStore("photos").put(blob, id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }).catch(function () { /* 保存できなくても続行 */ });
}
function loadPhoto(id) {
  return openPhotoDB().then(function (db) {
    return new Promise(function (resolve) {
      const req = db.transaction("photos").objectStore("photos").get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { resolve(null); };
    });
  }).catch(function () { return null; });
}


// ---------- モード切り替え（デモ / GPS） ----------
let mode = "demo";
let watchId = null;

// デモ：地図をタップした場所に「自分」が移動する（家で動作確認する用）
map.on("click", function (e) {
  if (mode === "demo") updatePosition(e.latlng.lat, e.latlng.lng, 5);
});

function startGps() {
  if (!("geolocation" in navigator)) { setStatus("この端末では位置情報が使えません"); return; }
  if (!window.isSecureContext) { setStatus("位置情報は https のページでしか使えません"); return; }
  setStatus("現在地を取得中…");
  askNotificationPermission();
  watchId = navigator.geolocation.watchPosition(
    function (pos) { updatePosition(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy); },
    function (err) {
      const messages = {
        1: "位置情報の利用が許可されていません。設定を確認してください",
        2: "現在地を取得できませんでした",
        3: "現在地の取得に時間がかかっています"
      };
      setStatus(messages[err.code] || "位置情報のエラーです");
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}
function stopGps() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

// お知らせ（アプリを開いているあいだだけ。iPhone はホーム画面に追加したときだけ）
function askNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") Notification.requestPermission();
}
function notifyNearby(m, count) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then(function (reg) {
    reg.showNotification("近くにマークがあります" + (count > 1 ? "（" + count + "個）" : ""), {
      body: PARK_LABEL[m.park] + " " + displayName(m) + "　ヒントを見て探してみよう",
      icon: "icons/icon-192.png",
      tag: m.id
    });
  }).catch(function () { /* お知らせできなくても続行 */ });
}

// 「GPSで探しに行く」：最初の1回だけ引き出しに大きく出し、そのあとはメニューの中だけ。
// 前回 GPS を使っていたら、次に開いたときは自動で GPS をつける
const btnGps = document.getElementById("btn-gps");
const btnGpsMenu = document.getElementById("btn-gps-menu");
const btnDemo = document.getElementById("btn-demo");

function setMode(newMode) {
  mode = newMode;
  saveSetting("lastMode", mode);
  const gps = mode === "gps";
  [btnGps, btnGpsMenu].forEach(function (b) {
    b.setAttribute("aria-pressed", gps ? "true" : "false");
    b.textContent = gps ? "GPSで探索中（止める）" : "GPSで探しに行く";
  });
  btnDemo.classList.toggle("on", !gps);
  if (gps) {
    startGps();
    following = true;
    btnLocate.classList.add("active");
  } else {
    stopGps();
    setStatus("地図の番号をタップすると、ヒントが読めます");
  }
}
function toggleGpsFromButton() {
  setMode(mode === "gps" ? "demo" : "gps");
  saveSetting("gpsIntroDone", "yes");
  btnGps.classList.add("hidden");
  fitPeek();
}
btnGps.addEventListener("click", toggleGpsFromButton);
btnGpsMenu.addEventListener("click", function () { toggleGpsFromButton(); closeMenu(); });
btnDemo.addEventListener("click", function () { setMode("demo"); closeMenu(); });


// ---------- 現在地ボタン ----------
// 押すと地図を自分の位置にもどし、そのあとは歩くと地図がついてくる。指で地図を動かしたらやめる
const btnLocate = document.getElementById("btn-locate");
let following = false;
btnLocate.addEventListener("click", function () {
  if (!lastPos) {
    if (mode !== "gps") toggleGpsFromButton();
    return;
  }
  following = true;
  btnLocate.classList.add("active");
  map.setView([lastPos.lat, lastPos.lng], Math.max(map.getZoom(), 18));
});
map.on("dragstart", function () {
  following = false;
  btnLocate.classList.remove("active");
});


// ---------- メニュー ----------
const menuEl = document.getElementById("menu");
function openMenu() { menuEl.classList.remove("hidden"); }
function closeMenu() { menuEl.classList.add("hidden"); }
document.getElementById("btn-menu").addEventListener("click", openMenu);
document.getElementById("menu-close").addEventListener("click", closeMenu);
menuEl.addEventListener("click", function (e) { if (e.target === menuEl) closeMenu(); });


// ---------- 画面を消さない（Wake Lock） ----------
// 画面が消えると GPS も止まるので、探しているあいだは画面をつけたままにできる。
// アプリを切り替えるとスマホが自動で解除するので、戻ってきたら頼み直す
const btnScreen = document.getElementById("btn-screen");
let screenWanted = loadSetting("keepScreenOn") === "on";
let wakeLock = null;

function renderScreenButton() {
  const on = screenWanted && wakeLock !== null;
  btnScreen.textContent = "画面を消さない：" + (on ? "ON" : "OFF");
  btnScreen.classList.toggle("on", on);
  btnScreen.setAttribute("aria-pressed", on ? "true" : "false");
}
function requestWakeLock() {
  if (!screenWanted || wakeLock || document.visibilityState !== "visible") return;
  navigator.wakeLock.request("screen").then(function (lock) {
    wakeLock = lock;
    lock.addEventListener("release", function () { wakeLock = null; renderScreenButton(); });
    renderScreenButton();
  }).catch(function () {
    // 省電力モードなどで断られたら OFF にもどす（表示と設定を食い違わせない）
    wakeLock = null;
    screenWanted = false;
    saveSetting("keepScreenOn", "off");
    renderScreenButton();
    setStatus("画面を消さない設定ができませんでした（省電力モードなどを確認してください）");
  });
}
if ("wakeLock" in navigator) {
  btnScreen.classList.remove("hidden");
  btnScreen.addEventListener("click", function () {
    screenWanted = !screenWanted;
    saveSetting("keepScreenOn", screenWanted ? "on" : "off");
    if (screenWanted) requestWakeLock(); else if (wakeLock) wakeLock.release();
    renderScreenButton();
  });
  document.addEventListener("visibilitychange", requestWakeLock);
  requestWakeLock();
  renderScreenButton();
}


// ---------- 初めて開いたときの使い方 ----------
// 3枚の説明を順に見せる。一度見たら覚えておき、次からは出さない（メニューから見直せる）
const introEl = document.getElementById("intro");
const introNext = document.getElementById("intro-next");
let introPage = 0;

function showIntroPage(n) {
  introPage = n;
  document.querySelectorAll(".intro-page").forEach(function (p) {
    p.classList.toggle("hidden", Number(p.dataset.page) !== n);
  });
  document.querySelectorAll(".intro-dots span").forEach(function (d, i) {
    d.classList.toggle("on", i === n);
  });
  introNext.textContent = n === 2 ? "はじめる" : "つぎへ";
}
function openIntro() {
  showIntroPage(0);
  introEl.classList.remove("hidden");
}
function closeIntro() {
  introEl.classList.add("hidden");
  saveSetting("introSeen", "yes");
}
introNext.addEventListener("click", function () {
  if (introPage < 2) showIntroPage(introPage + 1); else closeIntro();
});
document.getElementById("intro-skip").addEventListener("click", closeIntro);
document.getElementById("btn-intro").addEventListener("click", function () {
  closeMenu();
  openIntro();
});


// ---------- 記録をすべて消す ----------
// スタンプの記録（localStorage）と、撮った写真（IndexedDB）を消す。消す前に必ず確認する
document.getElementById("btn-reset").addEventListener("click", function () {
  if (!window.confirm("スタンプの記録と撮った写真を、すべて消します。元に戻せません。よろしいですか？")) return;
  found.clear();
  saveFound();
  try { indexedDB.deleteDatabase("marumittsu"); } catch (e) { /* 消せなくても続行 */ }
  MARKS.forEach(function (m) { pins[m.id].setIcon(pinIcon(m)); });
  inside.clear();
  applyFilter();
  closeCard();
  closeMenu();
  setStatus("記録をすべて消しました");
});


// ---------- 開いたときの準備 ----------
btnGps.classList.toggle("hidden", loadSetting("gpsIntroDone") === "yes");
showPark(currentPark, true);
setMode(loadSetting("lastMode") === "gps" ? "gps" : "demo");
fitPeek();
if (loadSetting("introSeen") !== "yes") openIntro();


// ---------- オフライン対応（Service Worker の登録） ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(function (e) {
    console.warn("Service Worker を登録できませんでした", e);
  });
}
