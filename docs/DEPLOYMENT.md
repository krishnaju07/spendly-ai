# Deployment

One Node process serves the API and the built web app, backed by MongoDB. Put a TLS-terminating reverse proxy in front of it.

## Checklist

1. **MongoDB** — a managed cluster (Atlas) or the compose service. Enable backups.
2. **`SESSION_SECRET`** — `openssl rand -hex 32`. Keep it stable; rotating it only invalidates CSRF tokens (users re-load the page) and any sign-in code sent in the last few minutes.
3. **`APP_ORIGIN`** — the public `https://…` address.
4. **HTTPS** — terminate TLS at the proxy; set `TRUST_PROXY=1` (one proxy). Leave `COOKIE_SECURE` at its production default of `true`.
5. **Persistent uploads** — mount a volume at `UPLOAD_DIR`; it holds imported statements and receipts.
6. **Sign-in codes (required for real accounts)** — people sign in with a code texted to their mobile number, so set `SMS_PROVIDER` to `twilio` (plus the `TWILIO_*` values) or `webhook` (your own gateway, or a bridge to MSG91 / Fast2SMS). Production refuses the development `console` provider, and with no provider the sign-in screen says texting is not set up (the demo workspace still works). In India, providers require a registered sender ID and message template (DLT); the text Spendly sends is `<code> is your Spendly sign-in code. It expires in <N> minutes. Never share it with anyone.`
7. **AI (optional)** — `AI_PROVIDER`, `AI_API_KEY`; read [PRIVACY.md](PRIVACY.md) first and tell your users.

## Docker

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
export APP_ORIGIN=https://spendly.example.com
export COOKIE_SECURE=true TRUST_PROXY=1
docker compose up -d --build
```

The image is multi-stage (build, then a slim runtime running as the unprivileged `node` user), exposes port 4000, stores uploads in `/data/uploads`, and has a health check on `/api/v1/health`. The compose file adds MongoDB 8 with a named volume.

> The Dockerfile and compose file were written but **not built or run** in the environment where this repository was authored (no Docker available). Build once and watch the first start before relying on them.

## Without Docker

```bash
npm ci && npm run build
NODE_ENV=production PORT=4000 SESSION_SECRET=… MONGODB_URI=… APP_ORIGIN=https://… \
  UPLOAD_DIR=/var/lib/spendly/uploads node apps/api/dist/server.js
```

Run it under a supervisor (systemd, pm2). Example unit:

```ini
[Service]
User=spendly
WorkingDirectory=/opt/spendly/apps/api
EnvironmentFile=/etc/spendly.env
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
```

## Reverse proxy (nginx example)

```nginx
server {
  listen 443 ssl http2;
  server_name spendly.example.com;
  client_max_body_size 12m;            # a little above MAX_UPLOAD_MB

  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

The API sets a strict Content-Security-Policy, HSTS, `frame-ancestors 'none'` and related headers itself. Do not cache `/api/*`, `/sw.js` or `/index.html` at the proxy (the API already sends `no-cache` for the service worker, manifest and HTML).

## Cloudflare Pages auto-deploy

The web app can sit on Cloudflare Pages with the API on Render (see [render.yaml](../render.yaml)). [`deploy/cloudflare/_worker.js`](../deploy/cloudflare/_worker.js) serves the built app and forwards `/api/*` to the backend, so the browser keeps one origin. [`.github/workflows/deploy-cloudflare.yml`](../.github/workflows/deploy-cloudflare.yml) builds the web app and publishes it on every push to `main`, whatever changed (the backend deploys separately through Render). It also runs from the Actions tab (**Run workflow**).

One-time setup:

1. **API token** — Cloudflare dashboard → My Profile → API Tokens → Create Token → template **Edit Cloudflare Workers**, or a custom token with **Account → Cloudflare Pages → Edit**.
2. **Account ID** — shown in the dashboard sidebar of any zone or under Workers & Pages.
3. **GitHub** → repository Settings → Secrets and variables → Actions: add the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. If the Pages project is not called `spendly-ai`, add a repository **variable** `CLOUDFLARE_PAGES_PROJECT` with its name.
4. The Pages project's production branch must be `main`. Set `API_ORIGIN` on the project (Settings → Variables) if the backend is not at the fallback address in the worker, and set the backend's `APP_ORIGIN` to the Pages address.

A Pages project created by uploading a zip (Direct Upload) cannot be switched to Cloudflare's own Git integration, which is why the workflow publishes with Wrangler instead; it works for both kinds of project.

## Operations

- **Health:** `GET /api/v1/health` (200 `ok`, 503 `degraded` when MongoDB is unreachable).
- **Logs:** structured JSON (pino) with request ids; authorization data, cookies, mobile numbers and codes are redacted; query strings are never logged.
- **Backups:** back up MongoDB **and** the uploads volume together; imported files are referenced from the database.
- **Import worker:** runs inside the API process and claims jobs through atomic MongoDB updates, so several instances can run safely. Set `WORKER_ENABLED=false` on instances that should not process imports.
- **Demo workspaces:** created by `POST /auth/demo` (rate limited), labelled everywhere, and purged hourly after `DEMO_TTL_HOURS`.
- **Upgrades:** the service worker prompts users to reload when a new version is ready; they choose when.

## PWA notes

Installability needs HTTPS (localhost is exempt). The service worker precaches only the app shell and, on demand, same-origin font files (the alternative typefaces); `/api/*` is excluded, so no financial data is ever stored by it. Offline, the app opens and explains that data needs a connection.
