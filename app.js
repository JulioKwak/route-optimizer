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
const openExternalBtn = document.getElementById("openExternalBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const inAppHint = document.getElementById("inAppHint");

// iOS 안내 모달
const iosGuideModal = document.getElementById("iosGuideModal");
const iosGuideClose = document.getElementById("iosGuideClose");
const iosCopyLink = document.getElementById("iosCopyLink");
const iosOpenAgain = document.getElementById("iosOpenAgain");

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

// 카톡/인앱 브라우저 감지(대부분 커버)
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
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

// Share URL (data 파라미터)
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

// 동시성 제한
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const cur = idx++;
      if (cur >= items.length) break;
      results[cur] = await worker(items[cur], cur);
    }
  });
  await Promise.all(runners);
  return results;
}

// ===== Clipboard =====
async function copyText(text) {
  try {
    // iOS/인앱에서 여기서 실패할 수 있음 → 호출부에서 try/catch로 방어
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      // 구형 대응
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

// ===== iOS Guide Modal =====
function openIosGuideModal() {
  if (!iosGuideModal) return;
  iosGuideModal.hidden = false;
}
function closeIosGuideModal() {
  if (!iosGuideModal) return;
  iosGuideModal.hidden = true;
}

// 모달 닫기/버튼 이벤트 (한 번만 등록)
if (iosGuideClose) iosGuideClose.addEventListener("click", closeIosGuideModal);
if (iosGuideModal) {
  iosGuideModal.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.close) closeIosGuideModal();
  });
}
if (iosCopyLink) {
  iosCopyLink.addEventListener("click", async () => {
    const ok = await copyText(location.href);
    setMsg(ok ? "링크를 복사했습니다." : "복사 실패(수동으로 주소창 복사)");
  });
}
if (iosOpenAgain) {
  iosOpenAgain.addEventListener("click", () => closeIosGuideModal());
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
  if (!routeRes.ok || routeData.error) throw new Error(routeData.error || `directions api error (HTTP ${routeRes.status})`);
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
    let best = -1,
      bestD = Infinity;
    for (let i = 1; i < n; i++) {
      if (visited[i]) continue;
      const d = dist2(points[last], points[i]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    visited[best] = true;
    order.push(best);
  }
  return order;
}

// ===== Map =====
function clearMap() {
  if (routeLine) {
    routeLine.setMap(null);
    routeLine = null;
  }
  markers.forEach((m) => m.setMap(null));
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

  // 숫자 마커
  orderedPoints.forEach((p, i) => {
    const m = new naver.maps.Marker({
      position: new naver.maps.LatLng(p.lat, p.lng),
      map: nmap,
      title: String(i + 1),
      icon: {
        content: markerHtml(i + 1),
        anchor: new naver.maps.Point(12, 12),
      },
    });
    markers.push(m);
  });

  const linePath = pathLatLng.map((p) => new naver.maps.LatLng(p.lat, p.lng));
  routeLine = new naver.maps.Polyline({ map: nmap, path: linePath, strokeWeight: 5 });

  const bounds = new naver.maps.LatLngBounds();
  linePath.forEach((ll) => bounds.extend(ll));
  nmap.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 });
}

// ===== Result =====
async function renderResult(order) {
  resultList.innerHTML = "";
  order.forEach((idx, i) => {
    const r = state.rows[idx];
    const label = idx === 0 ? "시작" : `지점 ${idx}`;
    const li = document.createElement("li");
    li.textContent = `${i + 1}. [${label}] ${r.customer || "-"} / ${r.address}`;
    resultList.appendChild(li);
  });

  // 지도 경로
  try {
    showProgress("지도 경로 생성 중...", 98);
    const orderedPoints = order.map((i) => state.coords[i]);
    const routeData = await fetchRoutePath(orderedPoints);
    if (Array.isArray(routeData.path) && routeData.path.length) {
      drawRouteOnMap(routeData.path, orderedPoints);
    }
  } catch (e) {
    console.warn(e);
    setMsg(e.message);
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

    const addrs = state.rows.map((r) => r.address.trim());
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

// ===== In-app → External Browser helpers =====
function makeChromeIntentUrl(url) {
  const u = new URL(url);
  const hostPath = (u.host + u.pathname).replace(/^\//, "");
  const query = u.search ? u.search : "";
  const hash = `#Intent;scheme=https;package=com.android.chrome;end`;
  return `intent://${hostPath}${query}${hash}`;
}

function showInAppBannerIfNeeded() {
  if (!inAppBanner) return;
  if (!isMobile()) return;
  if (!isInAppBrowser()) return;

  inAppBanner.hidden = false;

  if (isAndroid()) {
    inAppHint.textContent = "Android: “외부 브라우저로 열기”를 누르면 Chrome으로 전환을 시도합니다.";
  } else if (isIOS()) {
    inAppHint.textContent =
      "iPhone: 카카오톡 화면에서 공유(⬆︎) 또는 메뉴에서 ‘Safari에서 열기’를 선택하세요. 없으면 ‘링크 복사’ 후 Safari에 붙여넣기 하시면 됩니다.";
    if (openExternalBtn) openExternalBtn.textContent = "Safari에서 열기 안내";
  } else {
    inAppHint.textContent = "인앱 브라우저에서는 일부 기능이 제한될 수 있습니다.";
  }

  if (copyLinkBtn) {
    copyLinkBtn.onclick = async () => {
      const url = location.href;
      const ok = await copyText(url);
      setMsg(ok ? "링크를 복사했습니다." : "복사 실패(수동으로 주소창 복사)");
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

// Share: QR/Link + “카톡 안내 문구”
if (shareBtn) {
  shareBtn.addEventListener("click", async () => {
    setMsg("");

    const url = buildShareUrl();
    if (shareUrlEl) shareUrlEl.value = url;
    if (shareBox) shareBox.hidden = false;

    // 카톡 안내 문구(아이폰 '…' 언급 제거)
    const guide =
`[경로 최적화 링크]
${url}

※ 카카오톡에서 누르면 앱 안(인앱브라우저)으로 열릴 수 있습니다.
- Android: 페이지 상단 “외부 브라우저로 열기” 버튼(Chrome 권장)
- iPhone: 공유(⬆︎) 또는 메뉴에서 “Safari에서 열기”
열린 다음 “네이버 지도 열기(다음 목적지)”를 누르세요.`;

    if (shareMsgEl) shareMsgEl.value = guide;

    if (qrEl) {
      qrEl.innerHTML = "";
      if (window.QRCode) {
        new QRCode(qrEl, { text: url, width: 160, height: 160 });
      } else {
        qrEl.textContent = "QR 라이브러리가 로드되지 않았습니다.";
      }
    }

    // iOS 인앱에서 복사 실패가 잦으니, 여기서는 자동복사 시도만(실패해도 OK)
    try { await copyText(url); } catch {}
  });
}

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(shareUrlEl.value || "");
    setMsg(ok ? "링크를 복사했습니다." : "복사 실패(수동으로 주소창 복사)");
  });
}

if (copyMsgBtn) {
  copyMsgBtn.addEventListener("click", async () => {
    const ok = await copyText(shareMsgEl.value || "");
    setMsg(ok ? "안내 문구를 복사했습니다." : "복사 실패(수동으로 선택 후 복사)");
  });
}

// ===== Init =====
(function init() {
  // ✅ 외부 브라우저/안내 버튼은 항상 동작하도록 1회 바인딩
  if (openExternalBtn) {
    openExternalBtn.onclick = async () => {
      const url = location.href;

      if (isIOS()) {
        // iOS 인앱에서 clipboard가 실패해도 모달은 무조건 뜨게
        try { await copyText(url); } catch {}
        openIosGuideModal();
        return;
      }

      if (isAndroid()) {
        const intentUrl = makeChromeIntentUrl(url);
        location.href = intentUrl;
        setTimeout(() => window.open(url, "_blank"), 800);
        return;
      }

      window.open(url, "_blank");
    };
  }

  hideProgress();

  const restored = readSharedDataFromUrl();
  if (restored) state.rows = restored;

  renderRows();

  // ⭐ 초기 지도 표시 (회색 방지) - 송도(인천 연수구 벤처로 82 근처)
  ensureMap({ lat: 37.3828, lng: 126.6569 });

  // 모바일 링크 진입(data=...)이면 자동 최적화
  // if (restored) runOptimize();

  // 카톡/인앱이면 배너 표시(외부 브라우저 유도)
  showInAppBannerIfNeeded();
})();
