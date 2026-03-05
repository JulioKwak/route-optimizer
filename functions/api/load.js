export async function onRequestGet({ request, env }) {

  const url = new URL(request.url);
  const id = url.searchParams.get("k");

  if (!id) {
    return new Response(
      JSON.stringify({ error: "key missing" }),
      { status: 400 }
    );
  }

  const data = await env.ROUTE_KV.get(id);

  if (!data) {
    return new Response(
      JSON.stringify({ error: "not found or expired" }),
      { status: 404 }
    );
  }

  return new Response(
    data,
    {
      headers: { "Content-Type": "application/json" }
    }
  );
}
