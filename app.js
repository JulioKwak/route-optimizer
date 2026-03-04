const MAX = 15;

const rowsEl = document.getElementById("rows");
const msgEl = document.getElementById("msg");
const addBtn = document.getElementById("addBtn");
const optBtn = document.getElementById("optBtn");
const naverBtn = document.getElementById("naverBtn");
const resultList = document.getElementById("resultList");

// 임시: 주소를 좌표로 바꾸는 기능은 다음 단계(Functions)에서 붙입니다.
// 지금은 “입력 UI + 최적화 결과(순서) + 네이버지도 열기 버튼” 흐름부터 만듭니다.

let state = {
  rows: [{ customer: "", address: "" }, { customer: "", address: "" }], // 시작 + 1개 기본
  optimized: null, // 최적화된 인덱스 배열
  currentLeg: 0,   // 다음 목적지(구간) 인덱스
};

function renderRows() {
  rowsEl.innerHTML = "";
  state.rows.forEach((r, idx) => {
    const row = document.createElement("div");
    row.className = "row";

    const customer = document.createElement("input");
    customer.placeholder = idx === 0 ? "시작(고객번호)" : "고객번호";
    customer.value = r.customer;
    customer.addEventListener("input", (e) => {
      state.rows[idx].customer = e.target.value;
    });

    const address = document.createElement("input");
    address.placeholder = idx === 0 ? "시작 주소" : "주소";
    address.value = r.address;
    address.addEventListener("input", (e) => {
      state.rows[idx].address = e.target.value;
    });

    const del = document.createElement("button");
    del.textContent = "−";
    del.title = "삭제";
    del.disabled = state.rows.length <= 2 || idx === 0; // 시작지점은 삭제 금지, 최소 2행 유지
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

// 임시 최적화: 지금은 “입력된 순서 그대로”를 결과로 보여줍니다.
// 다음 단계에서 좌표 기반 최적화(최근접+2-opt 등)를 붙입니다.
function optimizeOrder() {
  // 0은 시작, 1..N-1 방문
  const order = [0, ...Array.from({ length: state.rows.length - 1 }, (_, i) => i + 1)];
  return order;
}

function renderResult(order) {
  resultList.innerHTML = "";
  order.forEach((idx, i) => {
    const li = document.createElement("li");
    const r = state.rows[idx];
    const label = idx === 0 ? "시작" : `지점 ${idx}`;
    li.textContent = `${i + 1}. [${label}] ${r.customer || "-"} / ${r.address}`;
    resultList.appendChild(li);
  });
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

  const order = optimizeOrder();
  state.optimized = order;
  state.currentLeg = 0;

  renderResult(order);

  // “다음 목적지” 딥링크 버튼 활성화
  naverBtn.disabled = false;
  naverBtn.textContent = "네이버 지도 열기(다음 목적지)";
});

naverBtn.addEventListener("click", () => {
  if (!state.optimized) return;

  // 지금은 좌표가 없어서 “주소 문자열”로 네이버 지도 검색을 여는 임시버전입니다.
  // 다음 단계에서 지오코딩(좌표) 붙이면, nmap://route 딥링크로 바꿉니다.
  const order = state.optimized;

  const fromIdx = order[state.currentLeg];
  const toIdx = order[state.currentLeg + 1];

  if (toIdx == null) {
    naverBtn.textContent = "완료(마지막 지점)";
    naverBtn.disabled = true;
    return;
  }

  const from = state.rows[fromIdx].address;
  const to = state.rows[toIdx].address;

  // 임시: 네이버지도 웹 검색(모바일이면 앱으로 전환될 수도 있음)
  const url = `https://map.naver.com/v5/search/${encodeURIComponent(to)}`;
  window.location.href = url;

  // 다음 구간으로 이동(사용자가 “도착 후” 다시 누르는 방식)
  state.currentLeg += 1;
});

renderRows();
