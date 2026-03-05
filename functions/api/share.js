export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const payload = body?.payload;

    if (!payload) {
      return new Response(
        JSON.stringify({ error: "payload missing" }),
        { status: 400 }
      );
    }

    // 짧은 키 생성
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);

    // KV 저장 (TTL 7일)
    await env.ROUTE_KV.put(
      id,
      JSON.stringify(payload),
      {
        expirationTtl: 60 * 60 * 24 * 7
      }
    );

    return new Response(
      JSON.stringify({ id }),
      {
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500 }
    );
  }
}
