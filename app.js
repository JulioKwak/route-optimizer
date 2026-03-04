const MAX = 15;

const rowsEl = document.getElementById("rows");
const msgEl = document.getElementById("msg");
const addBtn = document.getElementById("addBtn");
const optBtn = document.getElementById("optBtn");
const naverBtn = document.getElementById("naverBtn");
const resultList = document.getElementById("resultList");

let state = {
  rows: [{ customer: "", address: "" }, { customer: "", address: "" }], // 시작 + 1개 기본
  optimized: null,   // 방문 순서(인덱스)
  coords: null,      // [{lat,lng}]
  currentLeg: 0,     // 다음 구간
};

function renderRows() {
  rowsEl.innerHTML = "";
  state.rows.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "row";

    const customer = document.createElement("input");
        // 모바일 입력 최적화(고객번호)
    customer.autocomplete = "off";
    customer.autocapitalize = "off";
    customer.spellcheck = false;
    customer.inputMode = "text"; // 숫자 키패드 방지
    customer.placeholder = idx === 0 ? "시작(고객번호)" : "고객번호";
    customer.value = r.customer;
    customer.addEventListener("input", (e) => (state.rows[idx].customer = e.target.value));

    const address = document.createElement("input");
        // 모바일 입력 최적화(주소)
    address.autocomplete = "street-address";
    address.autocapitalize = "off";
    address.spellcheck = false;
    address.inputMode = "text"; // 숫자 키패드 방지
    address.placeholder = idx === 0 ? "시작 주소(도로명 권장)" : "주소(도로명 권장)";
    address.value = r.address;
    address.addEventListener("input", (e) => (state.rows[idx].address = e.target.value));

    const del = document.createElement("button");
    del.textContent = "−";
    del.title = "삭제";
    del.disabled = state.rows.length <= 2 || idx === 0;
    del.addEventListener("click", () => {
      state.rows.splice(idx, 1);
      renderRows();
    });

    row.appendChild(customer);
    row.appendChild(address);
    row.appendChild(del);
    rowsEl.appendChild(row);
  });
}

function setMsg(text = "") {
  msgEl.textContent = text;
}

function validate() {
  if (!state.rows[0].address.trim()) return "시작 주소를 입력해 주세요.";
  for (let i = 1; i < state.rows.length; i++) {
    if (!state.rows[i].address.trim()) return `${i + 1}번째 주소가 비어 있습니다.`;
  }
  return null;
}

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

// 최근접 이웃(간단/빠름) : 8건이면 충분히 쓸만합니다.
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

function renderResult(order) {
  resultList.innerHTML = "";
  order.forEach((idx, i) => {
    const r = state.rows[idx];
    const label = idx === 0 ? "시작" : `지점 ${idx}`;
    const li = document.createElement("li");
    li.textContent = `${i + 1}. [${label}] ${r.customer || "-"} / ${r.address}`;
    resultList.appendChild(li);
  });
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

addBtn.addEventListener("click", () => {
  setMsg("");
  if (state.rows.length >= MAX) return setMsg(`최대 ${MAX}건까지 추가할 수 있습니다.`);
  state.rows.push({ customer: "", address: "" });
  renderRows();
});

optBtn.addEventListener("click", async () => {
  setMsg("");
  const err = validate();
  if (err) return setMsg(err);

  try {
    optBtn.disabled = true;
    optBtn.textContent = "좌표 변환 중...";

    // 1) 전체 주소 좌표 변환
    const coords = [];
    for (let i = 0; i < state.rows.length; i++) {
      const addr = state.rows[i].address.trim();
      try {
        coords.push(await geocode(addr));
      } catch (e) {
        throw new Error(`${i + 1}번째 주소 변환 실패: "${addr}" (${e.message})`);
      }
    }

    optBtn.textContent = "경로 계산 중...";

    // 2) 최적 순서 계산
    const order = optimizeOrderByNearest(coords);

    state.coords = coords;
    state.optimized = order;
    state.currentLeg = 0;

    renderResult(order);

    naverBtn.disabled = false;
    naverBtn.textContent = "네이버 지도 열기(다음 목적지)";
    setMsg("");
  } catch (e) {
    setMsg(e.message);
  } finally {
    optBtn.disabled = false;
    optBtn.textContent = "경로 최적화";
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

  // 모바일: 네이버지도 앱 딥링크
  const deeplink =
    `nmap://route/car?` +
    `slat=${fromC.lat}&slng=${fromC.lng}&sname=${fromName}` +
    `&dlat=${toC.lat}&dlng=${toC.lng}&dname=${toName}`;

  // PC: 네이버 지도 웹으로 목적지 검색(딥링크가 안 열릴 수 있음)
  const webUrl = `https://map.naver.com/v5/search/${encodeURIComponent(state.rows[toIdx].address)}`;

  window.location.href = isMobile() ? deeplink : webUrl;

  // 사용자가 “도착 후” 다시 누르면 다음 구간으로 넘어가는 방식
  state.currentLeg += 1;
});

renderRows();
