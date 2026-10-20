// Cloudflare Pages "advanced mode" worker: serves the built web app (apps/web/dist) and forwards /api/* to the Node backend,
// so the browser keeps talking to one origin (same-origin cookies and CSRF keep working). Set API_ORIGIN on the Pages project,
// (or edit FALLBACK_API_ORIGIN), and set the backend's APP_ORIGIN to this site's own address. Upload it in the zip root.
const FALLBACK_API_ORIGIN = 'https://spendly-ai-rq33.onrender.com'; // the Render service for this deployment

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const apiOrigin = env.API_ORIGIN || FALLBACK_API_ORIGIN;
    if (!apiOrigin) {
      return Response.json({ error: { code: 'backend_not_configured', message: 'API_ORIGIN is not set on this Pages project.' } }, { status: 503 });
    }
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', 'https');
    const client = request.headers.get('cf-connecting-ip');
    if (client) headers.set('x-forwarded-for', client);
    const target = new URL(url.pathname + url.search, apiOrigin);
    try {
      return await fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: 'manual', duplex: 'half' }));
    } catch {
      return Response.json({ error: { code: 'backend_unreachable', message: 'The backend did not answer.' } }, { status: 502 });
    }
  },
};
