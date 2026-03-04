export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const points = body.points; // [{lat,lng}, ...]  (최적화된 순서대로)

    if (!Array.isArray(points) || points.length < 2) {
      return json({ error: "points array required (min 2)" }, 400);
    }

    // Directions 15는 start/goal 형식이 "경도,위도" (lng,lat) 입니다. :contentReference[oaicite:1]{index=1}
    const start = `${points[0].lng},${points[0].lat}`;
    const goal = `${points[points.length - 1].lng},${points[points.length - 1].lat}`;

    // waypoints: 중간 지점들, '|'로 구분. :contentReference[oaicite:2]{index=2}
    const mid = points.slice(1, -1);
    const waypoints = mid.map(p => `${p.lng},${p.lat}`).join("|");

    // 엔드포인트는 계정/리전 환경에 따라 다를 수 있어서,
    // 기본값은 classic 도메인, 필요 시 env로 변경 가능하게 해둡니다.
    const base =
      env.NAVER_DIRECTIONS_BASE ||
      "https://maps.apigw.ntruss.com"; // 예: https://naveropenapi.apigw-pub.fin-ntruss.com

    const url = new URL(base + "/map-direction-15/v1");
    url.searchParams.set("start", start);
    url.searchParams.set("goal", goal);
    url.searchParams.set("option", "traoptimal");
    if (waypoints) url.searchParams.set("waypoints", waypoints);

    const res = await fetch(url.toString(), {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": env.NAVER_CLIENT_ID,
        "X-NCP-APIGW-API-KEY": env.NAVER_CLIENT_SECRET,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      return json({ error: "directions api error", detail: data }, res.status);
    }

    // 응답 구조: route.<option>[0].path 가 좌표열 (lng,lat) :contentReference[oaicite:3]{index=3}
    const route = data?.route?.traoptimal?.[0];
    const path = route?.path;

    if (!Array.isArray(path) || path.length === 0) {
      return json({ error: "no path in response", detail: data }, 500);
    }

    return json({
      summary: route.summary,
      // 프론트에서 쓰기 좋게 lat/lng 객체로 변환
      path: path.map(([lng, lat]) => ({ lat, lng })),
      raw: { code: data.code, message: data.message, currentDateTime: data.currentDateTime },
    });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
