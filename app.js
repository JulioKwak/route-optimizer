// app.js
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

// iOS inline guide (toggle)
const iosGuideInline = document.getElementById("iosGuideInline");
const iosGuideToggle = document.getElementById("iosGuideToggle");
const iosGuidePanel = document.getElementById("iosGuidePanel");

// Map + Card
const routeCard = document.getElementById("routeCard");
const cardTimeEl = document.getElementById("cardTime");
const cardDistEl = document.getElementById("cardDist");

// Map state
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

// ===== Map init callback (네이버 SDK callback=initMap) =====
window.initMap = function () {
  // 초기 회색 방지용 기본 지도(송도 벤처로 82 근처)
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
// 카톡/인앱 브라우저 감지(대부분 커버)
function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /KAKAOTALK|FBAN|FBAV|Instagram|Line|NAVER\(inapp\)/i.test(ua);
}

// base64url (legacy data=용)
function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

// ===== Share (short link via KV) =====
function buildPayloadFromState() {
  return {
    v: 1,
    rows: state.rows.map((r) => ({
      customer: (r.customer || "").trim(),
      address: (r.address || "").trim(),
    })),
  };
}

async function createShortShareUrl() {
  const payload = buildPayloadFromState();

  const res = await fetch("/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error || !data.id) throw new Error(data.error || "짧은 링크 생성 실패");

  const u = new URL(location.href);
  u.searchParams.delete("data");
  u.searchParams.set("k", data.id);
  u.hash = "";
  return u.toString();
}

async function readSharedDataFromKey() {
  const u = new URL(location.href);
  const k = u.searchParams.get("k");
  if (!k) return null;

  const res = await fetch(`/api/load?k=${encodeURIComponent(k)}`);
  if (!res.ok) return null;

  const payload = await res.json().catch(() => null);
  if (!payload || !Array.isArray(payload.rows) || payload.rows.length < 2) return null;

  const rows = payload.rows.slice(0, MAX).map((r) => ({
    customer: (r.customer ?? "").toString(),
    address: (r.address ?? "").toString(),
  }));
  while (rows.length < 2) rows.push({ customer: "", address: "" });
  return rows;
}

// legacy data= 복원 (하위호환)
function readSharedDataFromUrlLegacy() {
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

// ===== Validate =====
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

    const isStart = idx === 0;
    const isEnd = idx === state.rows.length - 1;

    customer.placeholder = isStart
      ? "시작(고객번호)"
      : isEnd
        ? "도착(고객번호)"
        : "고객번호";

    customer.value = r.customer;
    customer.addEventListener("input", (e) => (state.rows[idx].customer = e.target.value));

    const address = document.createElement("input");
    address.autocomplete = "street-address";
    address.autocapitalize = "off";
    address.spellcheck = false;
    address.inputMode = "text";

    address.placeholder = isStart
      ? "시작 주소(도로명 권장)"
      : isEnd
        ? "도착지 주소(도로명 권장)"
        : "주소(도로명 권장)";

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

  // 점이 2개 이하이면 그대로
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);

  const startIdx = 0;
  const endIdx = n - 1;

  const middle = [];
  for (let i = 1; i < endIdx; i++) {
    middle.push(i);
  }

  const order = [startIdx];
  let current = startIdx;

  while (middle.length > 0) {
    let bestPos = -1;
    let bestIdx = -1;
    let bestD = Infinity;

    for (let i = 0; i < middle.length; i++) {
      const candidate = middle[i];
      const d = dist2(points[current], points[candidate]);
      if (d < bestD) {
        bestD = d;
        bestIdx = candidate;
        bestPos = i;
      }
    }

    order.push(bestIdx);
    current = bestIdx;
    middle.splice(bestPos, 1);
  }

  // 마지막 도착지는 고정
  order.push(endIdx);

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
        anchor: new naver.maps.Point(13, 13),
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

// ===== Format =====
function formatDistance(meters) {
  if (meters == null || !isFinite(meters)) return "-";
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters)}m`;
}

function formatDuration(sec) {
  if (sec == null || !isFinite(sec)) return "-";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

// ===== Result =====
function updateRouteCard(summary) {
  if (!routeCard || !cardTimeEl || !cardDistEl) return;

  if (!summary) {
    routeCard.hidden = true;
    cardTimeEl.textContent = "-";
    cardDistEl.textContent = "-";
    return;
  }

  const dist = summary.distance;
  const durMs = summary.duration;

  routeCard.hidden = false;
  cardTimeEl.textContent = formatDuration(durMs != null ? durMs / 1000 : null);
  cardDistEl.textContent = formatDistance(dist);
}

async function renderResult(order) {
  // 결과 리스트(✅ "1. 1." 중복 제거: 텍스트에 번호를 넣지 않음)
  if (resultList) resultList.innerHTML = "";

  order.forEach((idx) => {
    const r = state.rows[idx];
    const label = idx === 0 ? "시작" : `지점 ${idx}`;
    const li = document.createElement("li");
    li.textContent = `[${label}] ${r.customer || "-"} / ${r.address}`;
    resultList.appendChild(li);
  });

  updateRouteCard(null);

  // 지도 경로 + 총 시간/거리 카드
  try {
    showProgress("지도 경로 생성 중...", 98);

    const orderedPoints = order.map((i) => state.coords[i]);
    const routeData = await fetchRoutePath(orderedPoints);

    // 지도 polyline
    if (Array.isArray(routeData.path) && routeData.path.length) {
      drawRouteOnMap(routeData.path, orderedPoints);
    }

    // ✅ 총 이동시간/거리 (routeData.summary 기준)
    if (routeData && routeData.summary) {
      updateRouteCard(routeData.summary);
    } else {
      updateRouteCard(null);
    }
  } catch (e) {
    console.warn(e);
    setMsg(e.message);
    updateRouteCard(null);
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

// ===== In-app banner + iOS inline guide =====
function setIosGuideExpanded(expanded) {
  if (!iosGuideToggle || !iosGuidePanel) return;
  iosGuideToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  iosGuidePanel.hidden = !expanded;
}

function showInAppBannerIfNeeded() {
  if (!inAppBanner) return;
  if (!isMobile()) return;
  if (!isInAppBrowser()) return;

  inAppBanner.hidden = false;

  // 공통: 링크 복사 버튼
  if (copyLinkBtn) {
    copyLinkBtn.onclick = async () => {
      const ok = await copyText(location.href);
      setMsg(ok ? "링크를 복사했습니다." : "복사 실패");
    };
  }

  if (isAndroid()) {
    if (inAppHint) inAppHint.textContent = "Android: 상단 “외부 브라우저로 열기(Chrome 권장)”를 사용하세요.";
    if (openExternalBtn) {
      openExternalBtn.hidden = false;
      openExternalBtn.textContent = "외부 브라우저로 열기";
      openExternalBtn.onclick = async () => {
        const url = location.href;
        const intentUrl = makeChromeIntentUrl(url);
        location.href = intentUrl;
        setTimeout(() => window.open(url, "_blank"), 800);
      };
    }
    if (iosGuideInline) iosGuideInline.hidden = true;
  } else if (isIOS()) {
    if (inAppHint) inAppHint.textContent = "iPhone: 아래 ‘Safari에서 열기 안내 보기’를 눌러 확인하세요.";
    // iOS는 회색 버튼(외부브라우저 열기) 숨김 유지
    if (openExternalBtn) openExternalBtn.hidden = true;

    // iOS 인라인 안내만 표시
    if (iosGuideInline) iosGuideInline.hidden = false;

    if (iosGuideToggle && iosGuidePanel) {
      // 초기 접힘
      setIosGuideExpanded(false);

      // 토글 클릭(접기/펼치기)
      iosGuideToggle.onclick = () => {
        const expanded = iosGuideToggle.getAttribute("aria-expanded") === "true";
        setIosGuideExpanded(!expanded);
      };
    }
  } else {
    if (inAppHint) inAppHint.textContent = "인앱 브라우저에서는 일부 기능이 제한될 수 있습니다.";
    if (openExternalBtn) {
      openExternalBtn.hidden = false;
      openExternalBtn.textContent = "새 창으로 열기";
      openExternalBtn.onclick = () => window.open(location.href, "_blank");
    }
    if (iosGuideInline) iosGuideInline.hidden = true;
  }
}

// ===== Events =====
if (addBtn) {
  addBtn.addEventListener("click", () => {
    setMsg("");
    if (state.rows.length >= MAX) return setMsg(`최대 ${MAX}건까지 추가할 수 있습니다.`);
    state.rows.push({ customer: "", address: "" });
    renderRows();
  });
}

if (optBtn) optBtn.addEventListener("click", runOptimize);

if (naverBtn) {
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
}

// Share: QR/Link + “카톡 안내 문구” (✅ 짧은 링크 k= 사용)
if (shareBtn) {
  shareBtn.addEventListener("click", async () => {
    setMsg("");

    let url = "";
    try {
      url = await createShortShareUrl();
    } catch (e) {
      console.warn(e);
      setMsg(e.message || "짧은 링크 생성 실패");
      return;
    }

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

    // QR
    if (qrEl) {
      qrEl.innerHTML = "";
      try {
        if (window.QRCode) {
          new QRCode(qrEl, {
            text: url,
            width: 240,
            height: 240,
            correctLevel: QRCode.CorrectLevel.L,
          });
        } else {
          qrEl.textContent = "QR 라이브러리가 로드되지 않았습니다.";
        }
      } catch (e) {
        console.warn(e);
        qrEl.textContent = "QR 생성 실패(콘솔 로그 확인)";
      }
    }
  });
}

if (copyBtn) {
  copyBtn.addEventListener("click", async () => {
    const ok = await copyText(shareUrlEl?.value || "");
    setMsg(ok ? "링크를 복사했습니다." : "복사 실패");
  });
}

if (copyMsgBtn) {
  copyMsgBtn.addEventListener("click", async () => {
    const ok = await copyText(shareMsgEl?.value || "");
    setMsg(ok ? "안내 문구를 복사했습니다." : "복사 실패");
  });
}

// ===== Init =====
(async function init() {
  hideProgress();

  // ✅ k= 우선 복원 → 없으면 legacy data= 복원
  let restored = await readSharedDataFromKey();
  if (!restored) restored = readSharedDataFromUrlLegacy();

  if (restored) {
    state.rows = restored;
    setMsg("주소가 복원되었습니다. ‘경로 최적화’를 눌러 계산하세요.");
  }

  renderRows();

  // 네이버 버튼 기본 비활성(계산 후 활성)
  if (naverBtn) {
    naverBtn.disabled = true;
    naverBtn.textContent = "경로 계산 후 활성화됩니다";
  }

  // 카드 초기 숨김
  updateRouteCard(null);

  // 인앱이면 안내(✅ iOS는 인라인 토글)
  showInAppBannerIfNeeded();

  // initMap callback이 못 도는 경우(네이버 SDK 로딩 지연 대비)
  setTimeout(() => {
    if (!nmap) ensureMap({ lat: 37.3828, lng: 126.6569 });
  }, 1000);
})();
