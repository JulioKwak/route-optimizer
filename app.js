// ===== Config =====
const MAX = 15;
const CONCURRENCY = 4; // 지오코딩 동시 처리 수(8건 기준 4 추천)

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

// Share (QR/Link)
const shareBtn = document.getElementById("shareBtn");
const shareBox = document.getElementById("shareBox");
const shareUrlEl = document.getElementById("shareUrl");
const copyBtn = document.getElementById("copyBtn");
const qrEl = document.getElementById("qr");

// Map
let nmap = null;
let routeLine = null;
let markers = [];

// ===== State =====
let state = {
  rows: [{ customer: "", address: "" }, { customer: "", address: "" }], // 시작 + 1개 기본
  optimized: null,  // 방문 순서(인덱스)
  coords: null,     // [{lat,lng}] (rows와 같은 인덱스)
  currentLeg: 0,    // 다음 구간
  errorMap: {},     // { [rowIndex]: "에러 메시지" }
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

// base64url (안전한 URL용)
function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const str = decodeURIComponent(escape(atob(b64)));
  return str;
}

function buildShareUrl() {
  const payload = {
    v: 1,
    rows: state.rows.map(r => ({
      customer: (r.customer || "").trim(),
      address: (r.address || "").trim(),
    })),
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const u = new URL(location.href);
  u.searchParams.set("data", encoded);
  // 해시 제거
  u.hash = "";
  return u.toString();
}

function readSharedDataFromUrl() {
  const u = new URL(location.href);
  const data = u.searchParams.get("data");
  if (!data) return null;

  try {
    const json = fromBase64Url(data);
    const obj = JSON.parse(json);
    if (!obj || !Array.isArray(obj.rows) || obj.rows.length < 2) return null;

    // 최대 15로 컷
    const rows = obj.rows.slice(0, MAX).map(r => ({
      customer: (r.customer ?? "").toString(),
      address: (r.address ?? "").toString(),
    }));

    // 최소 2개 보장
    while (rows.length < 2) rows.push({ customer: "", address: "" });

    return rows;
  } catch {
    return null;
  }
}

// ===== UI: Rows =====
function renderRows() {
  if (!rowsEl) return;
  rowsEl.innerHTML = "";

  state.rows.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "row";

    // 1) 번호 뱃지 (CSS: .idxBadge 필요)
    const badge = document.createElement("div");
    badge.className = "idxBadge";
    badge.textContent = `${idx + 1}.`;

    // 2) 고객번호
    const customer = document.createElement("input");
    customer.autocomplete = "off";
    customer.autocapitalize = "off";
    customer.spellcheck = false;
    customer.inputMode = "text"; // 숫자키패드 방지
    customer.placeholder = idx === 0 ? "시작(고객번호)" : "고객번호";
    customer.value = r.customer;

    customer.addEventListener("input", (e) => {
      state.rows[idx].customer = e.target.value;
    });

    // 3) 주소
    const address = document.createElement("input");
    address.autocomplete = "street-address";
    address.autocapitalize = "off";
    address.spellcheck = false;
    address.inputMode = "text";
    address.placeholder = idx === 0 ? "시작 주소(도로명 권장)" : "주소(도로명 권장)";
    address.value = r.address;

    // 실패 표시(빨간 테두리)
    if (state.errorMap[idx]) {
      address.classList.add("err");
      address.title = state.errorMap[idx];
    }

    address.addEventListener("input", (e) => {
      state.rows[idx].address = e.target.value;
      // 입력하면 해당 에러만 해제
      if (state.errorMap[idx]) {
        delete state.errorMap[idx];
        address.classList.remove("err");
        address.title = "";
      }
    });

    // 4) 삭제
    const del = document.createElement("button");
    del.textContent = "−";
    del.title = "삭제";
    del.disabled = state.rows.length <= 2 || idx === 0;
    del.addEventListener("click", () => {
      state.rows.splice(idx, 1);
      // 삭제 후 에러맵 재정렬(간단히 초기화)
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

function validate() {
  if (!state.rows[0].address.trim()) return "시작 주소를 입력해 주세요.";
  for (let i = 1; i < state.rows.length; i++) {
    if (!state.rows[i].address.trim()) return `${i + 1}번째 주소가 비어 있습니다.`;
  }
  return null;
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
  try { routeData = JSON.parse(text); } catch { routeData = { raw: text }; }

  if (!routeRes.ok || routeData.error) {
    console.error("ROUTE API FAIL:", routeRes.status, routeData);
    throw new Error(routeData.error || `directions api error (HTTP ${routeRes.status})`);
  }
  return routeData; // { path:[{lat,lng}], summary?... }
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
    let best = -1;
    let bestD = Infinity;

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

// 동시성 제한 병렬 처리
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
    nmap = new naver.maps.Map(el, {
      center,
      zoom: 12,
    });
  } else {
    nmap.setCenter(center);
  }
}

// 숫자 마커 HTML
function markerHtml(num) {
  return `<div class="numMarker">${num}</div>`;
}

function drawRouteOnMap(pathLatLng, orderedPoints) {
  if (!window.naver?.maps) return;
  if (!orderedPoints?.length) return;

  ensureMap(orderedPoints[0]);
  if (!nmap) return;

  clearMap();

  // 마커(숫자)
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

  // 폴리라인
  const linePath = pathLatLng.map(p => new naver.maps.LatLng(p.lat, p.lng));
  routeLine = new naver.maps.Polyline({
    map: nmap,
    path: linePath,
    strokeWeight: 5,
  });

  // fitBounds
  const bounds = new naver.maps.LatLngBounds();
  linePath.forEach(ll => bounds.extend(ll));
  nmap.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 });
}

// ===== Result =====
async function renderResult(order) {
  // 리스트
  resultList.innerHTML = "";
  order.forEach((idx, i) => {
    const r = state.rows[idx];
    const label = idx === 0 ? "시작" : `지점 ${idx}`;
    const li = document.createElement("li");
    li.textContent = `${i + 1}. [${label}] ${r.customer || "-"} / ${r.address}`;
    resultList.appendChild(li);
  });

  // 지도 경로(가능하면)
  try {
    showProgress("지도 경로 생성 중...", 98);
    const orderedPoints = order.map(i => state.coords[i]);
    const routeData = await fetchRoutePath(orderedPoints);
    if (Array.isArray(routeData.path) && routeData.path.length) {
      drawRouteOnMap(routeData.path, orderedPoints);
    }
  } catch (e) {
    // 지도 실패해도 순서/네비는 계속 쓰게
    console.warn(e);
    setMsg(e.message);
  }
}

// ===== Main Optimize Runner =====
async function runOptimize() {
  setMsg("");
  hideProgress();
  state.errorMap = {}; // 이전 에러 초기화
  renderRows();

  const err = validate();
  if (err) {
    hideProgress();
    return setMsg(err);
  }

  try {
    optBtn.disabled = true;
    naverBtn.disabled = true;

    showProgress("좌표 변환 준비 중...", 0);

    const addrs = state.rows.map(r => r.address.trim());
    const total = addrs.length;

    // 지오코딩 병렬 + 실패 주소만 표시
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
    // 실패한 주소만 빨간 표시
    renderRows();
    hideProgress();
    setMsg(e.message);
  } finally {
    optBtn.disabled = false;
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

  // 모바일: 네이버지도 앱 딥링크(다음 목적지)
  const deeplink =
    `nmap://route/car?` +
    `slat=${fromC.lat}&slng=${fromC.lng}&sname=${fromName}` +
    `&dlat=${toC.lat}&dlng=${toC.lng}&dname=${toName}`;

  // PC: 네이버 지도 웹 검색
  const webUrl = `https://map.naver.com/v5/search/${encodeURIComponent(state.rows[toIdx].address)}`;

  window.location.href = isMobile() ? deeplink : webUrl;

  state.currentLeg += 1;
});

// Share: QR/Link
if (shareBtn) {
  shareBtn.addEventListener("click", () => {
    setMsg("");

    const url = buildShareUrl();
    if (shareUrlEl) shareUrlEl.value = url;
    if (shareBox) shareBox.hidden = false;

    // QR 생성(중복 생성 방지)
    if (qrEl) {
      qrEl.innerHTML = "";
      if (window.QRCode) {
        // QRCode 라이브러리 필요(qrcode.min.js)
        new QRCode(qrEl, { text: url, width: 160, height: 160 });
      } else {
        qrEl.textContent = "QR 라이브러리가 로드되지 않았습니다.";
      }
    }
  });
}

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareUrlEl.value || "");
      setMsg("링크를 복사했습니다.");
    } catch {
      setMsg("복사 실패: 브라우저 권한을 확인해 주세요.");
    }
  });
}

// ===== Init =====
(function init() {
  hideProgress();

  // URL data가 있으면 rows 복원
  const restored = readSharedDataFromUrl();
  if (restored) {
    state.rows = restored;
  }

  renderRows();

  // 모바일 링크 진입(data=...)이면 자동 최적화 → 네이버 버튼 자동 활성화
  if (restored) {
    // 사용자 경험상 바로 실행
    runOptimize();
  } else {
    // 기본 지도는 필요할 때만 그려도 되지만, 초기 회색이 싫으면 아래 주석 해제
    // ensureMap({ lat: 37.5665, lng: 126.9780 });
  }
})();
