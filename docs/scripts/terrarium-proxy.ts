export async function proxyTerrarium(url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/terrarium/web/')) return null;
  const upstream = new URL(
    `${url.pathname}${url.search}`,
    'https://aletheia-works.github.io',
  );
  try {
    const response = await fetch(upstream);
    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') ?? 'application/octet-stream',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: unknown) {
    return new Response(`Terrarium asset fetch failed: ${String(error)}`, {
      status: 502,
    });
  }
}
