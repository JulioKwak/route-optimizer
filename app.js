// ===== Config =====
const MAX = 15;
const CONCURRENCY = 4;

// ===== DOM =====
const rowsEl = document.getElementById("rows");
const msgEl = document.getElementById("msg");

const addBtn = document.getElementById("addBtn");
const optBtn = document.getElementById("optBtn");
const naverBtn = document.getElementById("naverBtn");
const resultList = document.getElementById("resultList");

const progressWrap = document.getElementById("progressWrap");
const progressText = document.getElementById("progressText");
const progressBarFill = document.getElementById("progressBarFill");

// ✅ Map overlay card
const routeCard = document.getElementById("routeCard");
const cardTimeEl = document.getElementById("cardTime");
const cardDistEl = document.getElementById("cardDist");

// ✅ Leg list
const legListEl = document.getElementById("legList");

// Share
const shareBtn = document.getElementById("shareBtn");
const shareBox = document.getElementById("shareBox");
const shareUrlEl = document.getElementById("shareUrl");
const copyBtn = document.getElementById("copyBtn");
const qrEl = document.getElementById("qr");
const shareMsgEl = document.getElementById("shareMsg");
const copyMsgBtn = document.getElementById("copyMsgBtn");

// In-app banner
const inAppBanner = document.getElementById("inAppBanner");
const openExternalBtn = document.getElementById("openExternalBtn"); // Android에서만 사용 (iOS에선 hidden)
const copyLinkBtn = document.getElementById("copyLinkBtn");
const inAppHint = document.getElementById("inAppHint");

// ✅ iOS 인라인 안내(파란 글씨 토글만 사용)
const iosGuideInline = document.getElementById("iosGuideInline");
const iosGuideToggle = document.getElementById("iosGuideToggle");
const iosGuidePanel = document.getElementById("iosGuidePanel");

// Map
let nmap = null;
let routeLine = null;
let markers = [];

// ===== State =====
let state = {
  rows: [{ customer: "", address: "" }, { customer: "", address: "" }],
  optimized: null,
  coords: null,
  currentLeg: 0,
  errorMap: {},
};

// ===== Map init callback =====
window.initMap = function () {
  ensureMap({ lat: 37.3828, lng: 126.6569 });
};

// ===== Utils =====
function setMsg(text = "") {
  if (msgEl) msgEl.textContent = text;
}

function showProgress(text = "처리 중...", pct = 0) {
  if (!progressWrap) return;
  progressWrap.hidden = false;
  if (progressText) progressText.textContent = text;
  if (progressBarFill) progressBarFill.style.width = `${pct}%`;
}

function hideProgress() {
  if (!progressWrap) return;
  progressWrap.hidden = true;
  if (progressBarFill) progressBarFill.style.width = "0%";
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}
function isIOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}
function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /KAKAOTALK|FBAN|FBAV|Instagram|Line|NAVER\(inapp\)/i.test(ua);
}

// base64url
function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(b64url) {
  const b64 =
    b64url.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((b64url.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

// format
function formatDuration(sec) {
  sec = Math.max(0, Math.round(Number(sec || 0)));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}
function formatDistance(meters) {
  meters = Math.max(0, Math.round(Number(meters || 0)));
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${meters}m`;
}
function toSecondsSmart(durationMaybeMsOrSec) {
  const n = Number(durationMaybeMsOrSec);
  if (!Number.isFinite(n)) return null;
  // 네이버 summary.duration은 ms인 경우가 많아서, 큰 값이면 ms로 판단
  return n > 100000 ? Math.round(n / 1000) : Math.round(n);
}

// Share URL
function buildShareUrl() {
  const payload = {
    v: 1,
    rows: state.rows.map((r) => ({
      customer: (r.customer || "").trim(),
      address: (r.address || "").trim(),
    })),
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const u = new URL(location.href);
  u.searchParams.set("data", encoded);
  u.hash = "";
  return u.toString();
}

function readSharedDataFromUrl() {
  const u = new URL(location.href);
  const data = u.searchParams.get("data");
  if (!data) return null;
  try {
    const obj = JSON.parse(fromBase64Url(data));
    if (!obj || !Array.isArray(obj.rows) || obj.rows.length < 2) return null;
    const rows = obj.rows.slice(0, MAX).map((r) => ({
      customer: (r.customer ?? "").toString(),
      address: (r.address ?? "").toString(),
    }));
    while (rows.length < 2) rows.push({ customer: "", address: "" });
    return rows;
  } catch {
    return null;
  }
}

function validate() {
  if (!state.rows[0].address.trim()) return "시작 주소를 입력해 주세요.";
  for (let i = 1; i < state.rows.length; i++) {
    if (!state.rows[i].address.trim()) return `${i + 1}번째 주소가 비어 있습니다.`;
  }
  return null;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
      while (true) {
        const cur = idx++;
        if (cur >= items.length) break;
        results[cur] = await worker(items[cur], cur);
      }
    });
  await Promise.all(runners);
  return results;
}

// ===== UI: Rows =====
function renderRows() {
  if (!rowsEl) return;
  rowsEl.innerHTML = "";

  state.rows.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "row";

    const badge = document.createElement("div");
    badge.className = "idxBadge";
    badge.textContent = `${idx + 1}.`;

    const customer = document.createElement("input");
    customer.autocomplete = "off";
    customer.autocapitalize = "off";
    customer.spellcheck = false;
    customer.inputMode = "text";
    customer.placeholder = idx === 0 ? "시작(고객번호)" : "고객번호";
    customer.value = r.customer;
    customer.addEventListener("input", (e) => (state.rows[idx].customer = e.target.value));

    const address = document.createElement("input");
    address.autocomplete = "street-address";
    address.autocapitalize = "off";
    address.spellcheck = false;
    address.inputMode = "text";
    address.placeholder = idx === 0 ? "시작 주소(도로명 권장)" : "주소(도로명 권장)";
    address.value = r.address;

    if (state.errorMap[idx]) {
      address.classList.add("err");
      address.title = state.errorMap[idx];
    }
    address.addEventListener("input", (e) => {
      state.rows[idx].address = e.target.value;
      if (state.errorMap[idx]) {
        delete state.errorMap[idx];
        address.classList.remove("err");
        address.title = "";
      }
    });

    const del = document.createElement("button");
    del.textContent = "−";
    del.title = "삭제";
    del.disabled = state.rows.length <= 2 || idx === 0;
    del.addEventListener("click", () => {
      state.rows.splice(idx, 1);
      state.errorMap = {};
      renderRows();
    });

    row.appendChild(badge);
    row.appendChild(customer);
    row.appendChild(address);
    row.appendChild(del);
    rowsEl.appendChild(row);
  });
}

// ===== API =====
async function geocode(address) {
  const res = await fetch("/geo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "geocode failed");
  return { lat: Number(data.lat), lng: Number(data.lng) };
}

async function fetchRoutePath(orderedPoints) {
  const routeRes = await fetch("/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points: orderedPoints }),
  });
  const text = await routeRes.text();
  let routeData = {};
  try {
    routeData = JSON.parse(text);
  } catch {
    routeData = { raw: text };
  }
  if (!routeRes.ok || routeData.error) {
    throw new Error(routeData.error || `directions api error (HTTP ${routeRes.status})`);
  }
  return routeData;
}

// ===== Optimize =====
function dist2(a, b) {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return dx * dx + dy * dy;
}
function optimizeOrderByNearest(points) {
  const n = points.length;
  const visited = new Array(n).fill(false);
  const order = [0];
  visited[0] = true;

  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let best = -1, bestD = Infinity;
    for (let i = 1; i < n; i++) {
      if (visited[i]) continue;
      const d = dist2(points[last], points[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    visited[best] = true;
    order.push(best);
  }
  return order;
}

// ===== Map =====
function clearMap() {
  if (routeLine) { routeLine.setMap(null); routeLine = null; }
  markers.forEach(m => m.setMap(null));
  markers = [];
}

function ensureMap(centerLatLng) {
  const el = document.getElementById("map");
  if (!el) return;
  if (!window.naver?.maps) return;

  const center = new naver.maps.LatLng(centerLatLng.lat, centerLatLng.lng);
  if (!nmap) {
    nmap = new naver.maps.Map(el, { center, zoom: 12 });
  } else {
    nmap.setCenter(center);
  }
}

function markerHtml(num) {
  return `<div class="numMarker">${num}</div>`;
}

function drawRouteOnMap(pathLatLng, orderedPoints) {
  if (!window.naver?.maps) return;
  if (!orderedPoints?.length) return;

  ensureMap(orderedPoints[0]);
  if (!nmap) return;

  clearMap();

  orderedPoints.forEach((p, i) => {
    const m = new naver.maps.Marker({
      position: new naver.maps.LatLng(p.lat, p.lng),
      map: nmap,
      title: String(i + 1),
      icon: {
        content: markerHtml(i + 1),
        anchor: new naver.maps.Point(13, 13),
      },
    });
    markers.push(m);
  });

  const linePath = pathLatLng.map(p => new naver.maps.LatLng(p.lat, p.lng));
  routeLine = new naver.maps.Polyline({ map: nmap, path: linePath, strokeWeight: 5 });

  const bounds = new naver.maps.LatLngBounds();
  linePath.forEach(ll => bounds.extend(ll));
  nmap.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 });
}

// ===== Legs extraction =====
function getPointLabelByRowIndex(rowIdx) {
  const r = state.rows[rowIdx];
  const name = (r.customer || "").trim();
  const addr = (r.address || "").trim();
  if (name && addr) return `${name} / ${addr}`;
  return addr || name || "-";
}

function extractLegs(routeData, order) {
  // 기대: waypoints(=중간지점 각 구간), goal(=마지막 구간)
  const legs = [];
  const wp = Array.isArray(routeData.waypoints) ? routeData.waypoints : [];

  // 0..(n-2) legs
  for (let i = 0; i < order.length - 1; i++) {
    let dur = null, dist = null;

    if (i < wp.length) {
      dur = wp[i]?.duration;
      dist = wp[i]?.distance;
    } else {
      dur = routeData.goal?.duration ?? null;
      dist = routeData.goal?.distance ?? null;
    }

    const sec = toSecondsSmart(dur);
    const meters = Number(dist);
    legs.push({
      fromRowIdx: order[i],
      toRowIdx: order[i + 1],
      sec: sec,
      meters: Number.isFinite(meters) ? meters : null,
    });
  }
  return legs;
}

// ===== Result =====
async function renderResult(order) {
  // 결과 리스트(✅ "1. 1." 중복 제거: 텍스트에 번호를 넣지 않음)
  resultList.innerHTML = "";
  order.forEach((idx) => {
    const r = state.rows[idx];
    const label = idx === 0 ? "시작" : `지점 ${idx}`;
    const li = document.createElement("li");
    li.textContent = `[${label}] ${r.customer || "-"} / ${r.address}`;
    resultList.appendChild(li);
  });

  if (legListEl) legListEl.innerHTML = "";
  if (routeCard) routeCard.hidden = true;
  if (cardTimeEl) cardTimeEl.textContent = "-";
  if (cardDistEl) cardDistEl.textContent = "-";

  try {
    showProgress("지도 경로 생성 중...", 98);

    const orderedPoints = order.map(i => state.coords[i]);
    const routeData = await fetchRoutePath(orderedPoints);

    // 총 시간/거리: 네이버 내비와 최대한 동일하게(= summary값 우선)
    const totalSec = toSecondsSmart(routeData.summary?.duration ?? routeData.totalDurationSec);
    const totalMeters = Number(routeData.summary?.distance ?? routeData.totalDistanceMeters);

    if (routeCard) routeCard.hidden = false;
    if (cardTimeEl) cardTimeEl.textContent = totalSec != null ? formatDuration(totalSec) : "-";
    if (cardDistEl) cardDistEl.textContent = Number.isFinite(totalMeters) ? formatDistance(totalMeters) : "-";

    // 지도 경로
    if (Array.isArray(routeData.path) && routeData.path.length) {
      drawRouteOnMap(routeData.path, orderedPoints);
    }

    // 구간별(leg) 표시
    if (legListEl) {
      const legs = extractLegs(routeData, order);

      legs.forEach((leg, i) => {
        const fromTxt = getPointLabelByRowIndex(leg.fromRowIdx);
        const toTxt = getPointLabelByRowIndex(leg.toRowIdx);

        const t = leg.sec != null ? formatDuration(leg.sec) : "-";
        const d = leg.meters != null ? formatDistance(leg.meters) : "-";

        const li = document.createElement("li");
        li.textContent = `${i + 1}) ${fromTxt} → ${toTxt}  (${t} · ${d})`;
        legListEl.appendChild(li);
      });
    }
  } catch (e) {
    console.warn(e);
    setMsg(e.message);
    if (routeCard) routeCard.hidden = true;
    if (cardTimeEl) cardTimeEl.textContent = "-";
    if (cardDistEl) cardDistEl.textContent = "-";
    if (legListEl) legListEl.innerHTML = "";
  }
}

// ===== Main Optimize Runner =====
async function runOptimize() {
  setMsg("");
  hideProgress();
  state.errorMap = {};
  renderRows();

  const err = validate();
  if (err) return setMsg(err);

  try {
    optBtn.disabled = true;
    naverBtn.disabled = true;

    showProgress("좌표 변환 준비 중...", 0);

    const addrs = state.rows.map(r => r.address.trim());
    const total = addrs.length;

    const coords = await mapLimit(addrs, CONCURRENCY, async (addr, i) => {
      showProgress(`좌표 변환 중... (${i + 1}/${total})`, Math.round((i / total) * 85));
      try {
        return await geocode(addr);
      } catch (e) {
        state.errorMap[i] = e.message || "주소 변환 실패";
        throw new Error(`${i + 1}번째 주소 변환 실패: "${addr}" (${e.message})`);
      }
    });

    showProgress("경로 계산 중...", 95);
    const order = optimizeOrderByNearest(coords);

    state.coords = coords;
    state.optimized = order;
    state.currentLeg = 0;

    await renderResult(order);

    naverBtn.disabled = false;
    naverBtn.textContent = "네이버 지도 열기(다음 목적지)";

    showProgress("완료", 100);
    setTimeout(hideProgress, 400);
  } catch (e) {
    renderRows();
    hideProgress();
    setMsg(e.message);
  } finally {
    optBtn.disabled = false;
  }
}

// ===== External browser helpers =====
function makeChromeIntentUrl(url) {
  const u = new URL(url);
  const hostPath = (u.host + u.pathname).replace(/^\//, "");
  const query = u.search ? u.search : "";
  const hash = `#Intent;scheme=https;package=com.android.chrome;end`;
  return `intent://${hostPath}${query}${hash}`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  }
}

// ✅ iOS 인라인 안내(파란 글씨 토글)
function setIosGuideExpanded(expanded) {
  if (!iosGuideToggle || !iosGuidePanel) return;
  iosGuideToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  iosGuidePanel.hidden = !expanded;
  iosGuideToggle.textContent = expanded ? "Safari에서 열기 안내 닫기" : "Safari에서 열기 안내 보기";
}
if (iosGuideToggle) {
  iosGuideToggle.addEventListener("click", () => {
    const expanded = iosGuideToggle.getAttribute("aria-expanded") === "true";
    setIosGuideExpanded(!expanded);
  });
}

function showInAppBannerIfNeeded() {
  if (!inAppBanner) return;
  if (!isMobile()) return;
  if (!isInAppBrowser()) return;

  inAppBanner.hidden = false;

  if (isAndroid()) {
    if (inAppHint) inAppHint.textContent = "Android: 상단 “외부 브라우저로 열기(Chrome 권장)”를 사용하세요.";
    if (openExternalBtn) {
      openExternalBtn.hidden = false;
      openExternalBtn.textContent = "외부 브라우저로 열기";
    }
    if (iosGuideInline) iosGuideInline.hidden = true;
  } else if (isIOS()) {
    if (inAppHint) inAppHint.textContent = "iPhone: 공유(⬆︎) 버튼 → “Safari에서 열기”로 다시 열어주세요.";
    if (openExternalBtn) openExternalBtn.hidden = true;

    if (iosGuideInline) iosGuideInline.hidden = false;
    setIosGuideExpanded(false);
  } else {
    if (inAppHint) inAppHint.textContent = "인앱 브라우저에서는 일부 기능이 제한될 수 있습니다.";
  }

  if (copyLinkBtn) {
    copyLinkBtn.onclick = async () => {
      const ok = await copyText(location.href);
      setMsg(ok ? "링크를 복사했습니다." : "복사 실패");
    };
  }

  if (openExternalBtn) {
    openExternalBtn.onclick = async () => {
      const url = location.href;
      if (isIOS()) return;

      if (isAndroid()) {
        const intentUrl = makeChromeIntentUrl(url);
        location.href = intentUrl;
        setTimeout(() => window.open(url, "_blank"), 800);
        return;
      }
      window.open(url, "_blank");
    };
  }
}

// ===== Events =====
addBtn.addEventListener("click", () => {
  setMsg("");
  if (state.rows.length >= MAX) return setMsg(`최대 ${MAX}건까지 추가할 수 있습니다.`);
  state.rows.push({ customer: "", address: "" });
  renderRows();
});

optBtn.addEventListener("click", runOptimize);

naverBtn.addEventListener("click", () => {
  if (!state.optimized || !state.coords) return;

  const order = state.optimized;
  const fromIdx = order[state.currentLeg];
  const toIdx = order[state.currentLeg + 1];

  if (toIdx == null) {
    naverBtn.textContent = "완료(마지막 지점)";
    naverBtn.disabled = true;
    return;
  }

  const fromC = state.coords[fromIdx];
  const toC = state.coords[toIdx];

  const fromName = encodeURIComponent(state.rows[fromIdx].customer || "출발");
  const toName = encodeURIComponent(state.rows[toIdx].customer || "도착");

  const deeplink =
    `nmap://route/car?` +
    `slat=${fromC.lat}&slng=${fromC.lng}&sname=${fromName}` +
    `&dlat=${toC.lat}&dlng=${toC.lng}&dname=${toName}`;

  const webUrl = `https://map.naver.com/v5/search/${encodeURIComponent(state.rows[toIdx].address)}`;

  window.location.href = isMobile() ? deeplink : webUrl;
  state.currentLeg += 1;
});

// Share
if (shareBtn) {
  shareBtn.addEventListener("click", () => {
    setMsg("");

    const url = buildShareUrl();
    if (shareUrlEl) shareUrlEl.value = url;
    if (shareBox) shareBox.hidden = false;

    const guide = `[경로 최적화 링크]
${url}

※ 카카오톡에서 누르면 앱 안(인앱브라우저)으로 열릴 수 있습니다.
- Android: “외부 브라우저로 열기” 버튼(Chrome 권장)
- iPhone: 공유(⬆︎) 버튼 → “Safari에서 열기”
열린 다음 “경로 최적화”를 눌러 계산 후,
“네이버 지도 열기(다음 목적지)”로 내비게이션을 실행하세요.`;

    if (shareMsgEl) shareMsgEl.value = guide;

    if (qrEl) {
      qrEl.innerHTML = "";
      if (window.QRCode) {
        new QRCode(qrEl, { text: url, width: 160, height: 160 });
      } else {
        qrEl.textContent = "QR 라이브러리가 로드되지 않았습니다.";
      }
    }
  });
}

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(shareUrlEl.value || "");
    setMsg(ok ? "링크를 복사했습니다." : "복사 실패");
  });
}

if (copyMsgBtn) {
  copyMsgBtn.addEventListener("click", async () => {
    const ok = await copyText(shareMsgEl.value || "");
    setMsg(ok ? "안내 문구를 복사했습니다." : "복사 실패");
  });
}

// ===== Init =====
(function init() {
  hideProgress();

  const restored = readSharedDataFromUrl();
  if (restored) {
    state.rows = restored;
    setMsg("주소가 복원되었습니다. ‘경로 최적화’를 눌러 계산하세요.");
  }

  renderRows();

  if (naverBtn) {
    naverBtn.disabled = true;
    naverBtn.textContent = "경로 계산 후 활성화됩니다";
  }

  showInAppBannerIfNeeded();

  setTimeout(() => {
    if (!nmap) ensureMap({ lat: 37.3828, lng: 126.6569 });
  }, 1000);
})();
