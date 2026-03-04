export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const points = body.points; // [{lat,lng}, ...] (최적화된 순서대로)

    if (!Array.isArray(points) || points.length < 2) {
      return json({ error: "points array required (min 2)" }, 400);
    }

    // (중요) Directions는 "경도,위도" = (lng,lat)
    const start = `${points[0].lng},${points[0].lat}`;
    const goal = `${points[points.length - 1].lng},${points[points.length - 1].lat}`;

    const mid = points.slice(1, -1);
    const waypoints = mid.map((p) => `${p.lng},${p.lat}`).join("|");

    // 권장 기본 엔드포인트(문서 기준)
    // 계정 환경에 따라 maps.apigw.ntruss.com 을 쓰는 경우도 있으니 env로 바꿀 수 있게 유지
    const base =
      env.NAVER_DIRECTIONS_BASE ||
      "https://naveropenapi.apigw-pub.fin-ntruss.com"; // 문서 예시 :contentReference[oaicite:1]{index=1}

    // (중요) /driving 까지 포함해야 함 :contentReference[oaicite:2]{index=2}
    const url = new URL(base + "/map-direction-15/v1/driving");
    url.searchParams.set("start", start);
    url.searchParams.set("goal", goal);
    url.searchParams.set("option", "traoptimal");
    if (waypoints) url.searchParams.set("waypoints", waypoints);

    // env 값 존재 확인(없으면 401/403로 실패)
    if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
      return json(
        { error: "missing env", detail: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET not set" },
        500
      );
    }

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        // 헤더는 대소문자 무관이지만, 문서 표기대로 쓰는 게 안전합니다.
        "x-ncp-apigw-api-key-id": env.NAVER_CLIENT_ID,
        "x-ncp-apigw-api-key": env.NAVER_CLIENT_SECRET,
      },
    });

const text = await res.text();
let data = {};
try { data = JSON.parse(text); } catch { data = { raw: text }; }

if (!res.ok) {
  return json(
    {
      error: "directions api error",
      status: res.status,
      requestUrl: url.toString(),
      detail: data,
    },
    res.status
  );
}

    const route = data?.route?.traoptimal?.[0];
    const path = route?.path;

    if (!Array.isArray(path) || path.length === 0) {
      return json({ error: "no path in response", detail: data }, 500);
    }

    return json({
      summary: route.summary,
      path: path.map(([lng, lat]) => ({ lat, lng })), // 프론트용 변환
    });
  } catch (e) {
    return json({ error: e?.message || String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
