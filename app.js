// app.js
const MAX = 15;
const CONCURRENCY = 4;

const rowsEl = document.getElementById("rows");
const msgEl = document.getElementById("msg");

const addBtn = document.getElementById("addBtn");
const optBtn = document.getElementById("optBtn");
const naverBtn = document.getElementById("naverBtn");
const resultList = document.getElementById("resultList");

const progressWrap = document.getElementById("progressWrap");
const progressText = document.getElementById("progressText");
const progressBarFill = document.getElementById("progressBarFill");

const shareBtn = document.getElementById("shareBtn");
const shareBox = document.getElementById("shareBox");
const shareUrlEl = document.getElementById("shareUrl");
const copyBtn = document.getElementById("copyBtn");
const qrEl = document.getElementById("qr");
const shareMsgEl = document.getElementById("shareMsg");
const copyMsgBtn = document.getElementById("copyMsgBtn");

const inAppBanner = document.getElementById("inAppBanner");
const openExternalBtn = document.getElementById("openExternalBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const inAppHint = document.getElementById("inAppHint");

const iosGuideInline = document.getElementById("iosGuideInline");
const iosGuideToggle = document.getElementById("iosGuideToggle");
const iosGuidePanel = document.getElementById("iosGuidePanel");

const routeCard = document.getElementById("routeCard");
const cardTimeEl = document.getElementById("cardTime");
const cardDistEl = document.getElementById("cardDist");

let nmap = null;
let routeLine = null;
let markers = [];

let state = {
  rows: [{ customer: "", address: "" }, { customer: "", address: "" }],
  optimized: null,
  coords: null,
  currentLeg: 0,
  errorMap: {},
};

window.initMap = function () {
  ensureMap({ lat: 37.3828, lng: 126.6569 });
};

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

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toBase64Url(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

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

function dist2(a, b) {
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return dx * dx + dy * dy;
}

function optimizeOrderByNearest(points) {
  const n = points.length;
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

  order.push(endIdx);
  return order;
}

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

function markerHtml(type, label) {
  if (type === "start") {
    return `
      <div class="flagMarker">
        <div class="flagPole"></div>
        <div class="flagCloth start">S</div>
        <div class="flagBase"></div>
      </div>
    `;
  }

  if (type === "end") {
    return `
      <div class="flagMarker">
        <div class="flagPole"></div>
        <div class="flagCloth end">E</div>
        <div class="flagBase"></div>
      </div>
    `;
  }

  return `
    <div class="numPin">
      <div class="numPinHead">${escapeHtml(label)}</div>
      <div class="numPinTail"></div>
    </div>
  `;
}

function markerAnchorByType(type) {
  if (type === "start" || type === "end") {
    return new naver.maps.Point(12, 42);
  }
  return new naver.maps.Point(19, 43);
}

function drawRouteOnMap(pathLatLng, orderedPoints) {
  if (!window.naver?.maps) return;
  if (!orderedPoints?.length) return;

  ensureMap(orderedPoints[0]);
  if (!nmap) return;

  clearMap();

  orderedPoints.forEach((p, i) => {
    const isStart = i === 0;
    const isEnd = i === orderedPoints.length - 1;

    const type = isStart ? "start" : isEnd ? "end" : "stop";
    const label = isStart ? "S" : isEnd ? "E" : String(i);

    const m = new naver.maps.Marker({
      position: new naver.maps.LatLng(p.lat, p.lng),
      map: nmap,
      title: isStart ? "시작점" : isEnd ? "도착점" : `경유지 ${i}`,
      icon: {
        content: markerHtml(type, label),
        anchor: markerAnchorByType(type),
      },
    });

    markers.push(m);
  });

  const linePath = pathLatLng.map((p) => new naver.maps.LatLng(p.lat, p.lng));
  routeLine = new naver.maps.Polyline({
    map: nmap,
    path: linePath,
    strokeWeight: 6,
    strokeColor: "#2563eb",
    strokeOpacity: 0.9,
    strokeLineCap: "round",
    strokeLineJoin: "round"
  });

  const bounds = new naver.maps.LatLngBounds();
  linePath.forEach((ll) => bounds.extend(ll));
  nmap.fitBounds(bounds, { top: 50, right: 40, bottom: 50, left: 40 });
}

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

function buildResultTypeClass(pos, total) {
  if (pos === 0) return "start";
  if (pos === total - 1) return "end";
  return "stop";
}

function buildResultTypeText(pos, total) {
  if (pos === 0) return "시작";
  if (pos === total - 1) return "도착";
  return `경유 ${pos}`;
}

async function renderResult(order) {
  if (resultList) resultList.innerHTML = "";

  const total = order.length;

  order.forEach((idx, pos) => {
    const r = state.rows[idx];
    const item = document.createElement("li");
    item.className = "resultItem";

    const typeClass = buildResultTypeClass(pos, total);
    const typeText = buildResultTypeText(pos, total);
    const customerText = (r.customer || "-").trim() || "-";
    const addressText = (r.address || "-").trim() || "-";

    const flowHtml = pos < total - 1
      ? `
        <div class="resultFlow">
          <span class="resultFlowArrow">↓</span>
          <span>다음 이동</span>
        </div>
      `
      : "";

    item.innerHTML = `
      <div class="resultCard">
        <div class="resultBadgeWrap">
          <div class="resultOrder">${pos + 1}</div>
          <div class="resultType ${typeClass}">${typeText}</div>
        </div>

        <div class="resultBody">
          <div class="resultTop">
            <div class="resultCustomer">${escapeHtml(customerText)}</div>
            <div class="resultOriginIdx">입력 순번 ${idx + 1}</div>
          </div>
          <div class="resultAddress">${escapeHtml(addressText)}</div>
        </div>
      </div>
      ${flowHtml}
    `;
    resultList.appendChild(item);
  });

  updateRouteCard(null);

  try {
    showProgress("지도 경로 생성 중...", 98);

    const orderedPoints = order.map((i) => state.coords[i]);
    const routeData = await fetchRoutePath(orderedPoints);

    if (Array.isArray(routeData.path) && routeData.path.length) {
      drawRouteOnMap(routeData.path, orderedPoints);
    }

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
    if (openExternalBtn) openExternalBtn.hidden = true;
    if (iosGuideInline) iosGuideInline.hidden = false;

    if (iosGuideToggle && iosGuidePanel) {
      setIosGuideExpanded(false);
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

if (addBtn) {
  addBtn.addEventListener("click", () => {
    setMsg("");
    if (state.rows.length >= MAX) return setMsg(`최대 ${MAX}건까지 추가할 수 있습니다.`);
    state.rows.push({ customer: "", address: "" });
    state.errorMap = {};
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

(async function init() {
  hideProgress();

  let restored = await readSharedDataFromKey();
  if (!restored) restored = readSharedDataFromUrlLegacy();

  if (restored) {
    state.rows = restored;
    setMsg("주소가 복원되었습니다. ‘경로 최적화’를 눌러 계산하세요.");
  }

  renderRows();

  if (naverBtn) {
    naverBtn.disabled = true;
    naverBtn.textContent = "경로 계산 후 활성화됩니다";
  }

  updateRouteCard(null);
  showInAppBannerIfNeeded();

  setTimeout(() => {
    if (!nmap) ensureMap({ lat: 37.3828, lng: 126.6569 });
  }, 1000);
})();
