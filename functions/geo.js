export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const address = body.address;

    if (!address) {
      return new Response(JSON.stringify({ error: "address required" }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }

    const url =
      "https://maps.apigw.ntruss.com/map-geocode/v2/geocode?query=" +
      encodeURIComponent(address);

    const res = await fetch(url, {
      headers: {
        "X-NCP-APIGW-API-KEY-ID": env.NAVER_CLIENT_ID,
        "X-NCP-APIGW-API-KEY": env.NAVER_CLIENT_SECRET
      }
    });

    const data = await res.json();

    if (!data.addresses || data.addresses.length === 0) {
      return new Response(JSON.stringify({ error: "address not found" }), {
        headers: { "content-type": "application/json" }
      });
    }

    const location = data.addresses[0];

    return new Response(
      JSON.stringify({
        lat: location.y,
        lng: location.x
      }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
}
