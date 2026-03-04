/* app.js - full */

const MAX = 15;

// DOM
const rowsEl = document.getElementById("rows");
const msgEl = document.getElementById("msg");
const addBtn = document.getElementById("addBtn");
const optBtn = document.getElementById("optBtn");
const naverBtn = document.getElementById("naverBtn");
const resultList = document.getElementById("resultList");

const progressWrap = document.getElementById("progressWrap");
const progressText = document.getElementById("progressText");
const progressBarFill = document.getElementById("progressBarFill");

// Share (optional, but assumed present)
const shareBtn = document.getElementById("shareBtn");
const shareBox = document.getElementById("shareBox");
const shareUrlEl = document.getElementById("shareUrl");
const copyBtn = document.getElementById("copyBtn");
const qrEl = document.getElementById("qr");

// Map
let nmap = null;
let routeLine = null;
let markers = [];

// State
let state = {
  rows: [{ customer: "", address: "" }, { customer: "", address: "" }], // 시작 + 1개 기본
  optimized: null,   // 방문 순서(인덱스)
  coords: null,      // [{lat,lng}] rows와 같은 인덱스
  currentLeg: 0,     // 다음 구간
};

// ---------- Utils ----------
function setMsg(text = "") {
  msgEl.textContent = text;
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function showProgress(text, pct) {
  if (!progressWrap) return;
  progressWrap.hidden = false;
  if (progressText) progressText.textContent = text || "처리 중...";
  if (progressBarFill && typeof pct === "number") progressBarFill.style.width = `${pct}%`;
}

function hideProgress() {
  if (!progressWrap) return;
  progressWrap.hidden = true;
  if (progressBarFill) progressBarFill.style.width = "0%";
}

function validate() {
  if (!state.rows[0]?.address?.trim()) return "시작 주소를 입력해 주세요.";
  for (let i = 1; i < state.rows.length; i++) {
    if (!state.rows[i].address.trim()) return `${i + 1}번째 주소가 비어 있습니다.`;
  }
  return null;
}

// ---------- Share (PC → Mobile) ----------
function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(b64url) {
  const pad = "===".slice((b64url.length + 3) % 4);
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return decodeURIComponent(escape(atob(b64)));
}

function buildShareUrl() {
  const payload = { v: 1, rows: state.rows };
  const encoded = toBase64Url(JSON.stringify(payload));
  // hash 사용(서버로 전달 안 됨) → 공유용으로 안전/간단
  return `${location.origin}${location.pathname}#data=${encoded}`;
}

function renderShare(url) {
  if (!shareBox || !shareUrlEl || !qrEl) return;
  shareBox.hidden = false;
  shareUrlEl.value = url;

  // QR 재생성
  qrEl.innerHTML = "";
  if (typeof QRCode !== "undefined") {
    // eslint-disable-next-line no-undef
    new QRCode(qrEl, { text: url, width: 200, height: 200 });
  } else {
    // QR 라이브러리 로드 실패 시
    const p = document.createElement("div");
    p.textContent = "QR 라이브러리를 불러오지 못했습니다. 링크 복사로 이용해 주세요.";
    qrEl.appendChild(p);
  }
}

function loadFromUrl() {
  const hash = location.hash || "";
  const m = hash.match(/data=([^&]+)/);
  if (!m) return;

  try {
    const json = fromBase64Url(m[1]);
    const payload = JSON.parse(json);
    if (payload?.rows && Array.isArray(payload.rows)) {
      state.rows = payload.rows.slice(0, MAX);
    }
  } catch {
    // ignore
  }
}

// ---------- Geo / Route ----------
async function geocode(address) {
  const res = await fetch("/geo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || "geocode failed");
  return { lat: Number(data.lat), lng: Number(data.lng) };
}

// 거리 비교용(제곱거리)
function dist2(a, b) {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return dx * dx + dy * dy;
}

// 최근접 이웃
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

async function fetchRoutePath(orderedPoints) {
  const routeRes = await fetch("/route", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points: orderedPoints })
  });
  const routeData = await routeRes.json().catch(() => ({}));
  if (!routeRes.ok || routeData.error) {
    throw new Error(routeData.error || "route api failed");
  }
  return routeData; // {path:[{lat,lng}...], summary...}
}

// ---------- Map ----------
function ensureMap(centerLatLng) {
  // naver.maps가 없는 경우(지도 SDK 미로드) 대비
  if (typeof naver === "undefined" || !naver.maps) {
    throw new Error("네이버 지도 SDK가 로드되지 않았습니다. index.html의 maps.js를 확인해 주세요.");
  }

  if (!nmap) {
    nmap = new naver.maps.Map("map", {
      center: new naver.maps.LatLng(centerLatLng.lat, centerLatLng.lng),
      zoom: 12
    });
  } else {
    nmap.setCenter(new naver.maps.LatLng(centerLatLng.lat, centerLatLng.lng));
  }
}

function clearMap() {
  if (routeLine) {
    routeLine.setMap(null);
    routeLine = null;
  }
  markers.forEach(m => m.setMap(null));
  markers = [];
}

function drawRouteOnMap(pathLatLng, orderedPoints) {
  ensureMap(orderedPoints[0]);
  clearMap();

  // 마커
  orderedPoints.forEach((p, i) => {
    const m = new naver.maps.Marker({
      position: new naver.maps.LatLng(p.lat, p.lng),
      map: nmap,
      title: `${i + 1}`
    });
    markers.push(m);
  });

  // 폴리라인
  const linePath = pathLatLng.map(p => new naver.maps.LatLng(p.lat, p.lng));
  routeLine = new naver.maps.Polyline({
    map: nmap,
    path: linePath,
    strokeWeight: 5
  });

  // fitBounds
  const bounds = new naver.maps.LatLngBounds();
  linePath.forEach(ll => bounds.extend(ll));
  nmap.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 });
}

// ---------- UI Render ----------
function renderRows() {
  rowsEl.innerHTML = "";

  state.rows.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "row";

    // 번호(1.,2.,3.)
    const badge = document.createElement("div");
    badge.className = "idxBadge";
    badge.textContent = `${idx + 1}.`;

    const customer = document.createElement("input");
    customer.placeholder = idx === 0 ? "시작(고객번호)" : "고객번호";
    customer.value = r.customer;

    // 모바일 입력 최적화(고객번호)
    customer.autocomplete = "off";
    customer.autocapitalize = "off";
    customer.spellcheck = false;
    customer.inputMode = "text";

    customer.addEventListener("input", (e) => (state.rows[idx].customer = e.target.value));

    const address = document.createElement("input");
    address.placeholder = idx === 0 ? "시작 주소(도로명 권장)" : "주소(도로명 권장)";
    address.value = r.address;

    // 모바일 입력 최적화(주소)
    address.autocomplete = "street-address";
    address.autocapitalize = "off";
    address.spellcheck = false;
    address.inputMode = "text";

    address.addEventListener("input", (e) => (state.rows[idx].address = e.target.value));

    const del = document.createElement("button");
    del.textContent = "−";
    del.title = "삭제";
    del.disabled = state.rows.length <= 2 || idx === 0;
    del.addEventListener("click", () => {
      state.rows.splice(idx, 1);
      // 결과/지도 초기화
      state.optimized = null;
      state.coords = null;
      state.currentLeg = 0;
      naverBtn.disabled = true;
      naverBtn.textContent = "네이버 지도 열기(다음 목적지)";
      resultList.innerHTML = "";
      clearMap();
      renderRows();
    });

    // row 구성
    row.appendChild(badge);
    row.appendChild(customer);
    row.appendChild(address);
    row.appendChild(del);

    rowsEl.appendChild(row);
  });
}

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

  // 지도 경로(Directions 15)
  showProgress("지도 경로 생성 중...", 98);
  const orderedPoints = order.map(i => state.coords[i]);
  const routeData = await fetchRoutePath(orderedPoints);
  drawRouteOnMap(routeData.path, orderedPoints);
}

// ---------- Events ----------
addBtn.addEventListener("click", () => {
  setMsg("");
  if (state.rows.length >= MAX) return setMsg(`최대 ${MAX}건까지 추가할 수 있습니다.`);
  state.rows.push({ customer: "", address: "" });
  renderRows();
});

optBtn.addEventListener("click", async () => {
  setMsg("");
  hideProgress();

  const err = validate();
  if (err) {
    hideProgress();
    return setMsg(err);
  }

  try {
    optBtn.disabled = true;
    naverBtn.disabled = true;
    showProgress("좌표 변환 준비 중...", 0);

    // 좌표 변환(순차)
    const coords = [];
    const total = state.rows.length;

    for (let i = 0; i < total; i++) {
      const addr = state.rows[i].address.trim();
      showProgress(`좌표 변환 중... (${i + 1}/${total})`, Math.round((i / total) * 85));

      try {
        coords.push(await geocode(addr));
      } catch (e) {
        throw new Error(`${i + 1}번째 주소 변환 실패: "${addr}" (${e.message})`);
      }
    }

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
    hideProgress();
    setMsg(e.message);
  } finally {
    optBtn.disabled = false;
  }
});

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

  // 다음 구간으로 이동
  state.currentLeg += 1;
});

// Share button (optional)
if (shareBtn) {
  shareBtn.addEventListener("click", () => {
    setMsg("");

    const err = validate();
    if (err) return setMsg(err);

    const url = buildShareUrl();
    renderShare(url);
  });
}

if (copyBtn && shareUrlEl) {
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareUrlEl.value);
      setMsg("링크를 복사했습니다.");
    } catch {
      setMsg("복사에 실패했습니다. 링크를 길게 눌러 복사해 주세요.");
    }
  });
}

// ---------- Init ----------
loadFromUrl();
renderRows();
hideProgress();
