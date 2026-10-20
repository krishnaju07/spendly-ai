# Setup

## Requirements

- **Node.js ≥ 22.12** and npm ≥ 10 (`.nvmrc` pins a known-good version).
- **MongoDB.** In development you do not need to install it: `npm run dev` starts a real `mongod` (downloaded once by `mongodb-memory-server`, about 100 MB) and keeps its data under `.data/mongo`. If something is already listening on port 27017 it is used as is.

## Install and run

```bash
npm install
npm run dev
```

| Service | Address |
| --- | --- |
| Web app (Vite, hot reload) | <http://localhost:5173> |
| API | <http://localhost:4000/api/v1> (Vite proxies `/api` to it) |
| MongoDB | `mongodb://127.0.0.1:27017/spendly` |

Open the web app. You can **Try the demo workspace** (sample data in a separate, clearly labelled workspace that deletes itself after 24 hours) or **Create an account**.

Signing in uses a **mobile number and a texted code** — there are no passwords. In development no text message is sent: the code appears on the sign-in screen under a clearly labelled *Development mode* note (and in the API log), so you can try everything without an SMS account. To send real texts see *Sign-in codes* in [ENVIRONMENT.md](ENVIRONMENT.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

To run the pieces separately: `npm run dev:db`, `npm run dev -w @spendly/api`, `npm run dev -w @spendly/web`.

## Configuration

No configuration is needed for development. To change anything, copy `.env.example` to `.env` and edit it; every variable is described in [ENVIRONMENT.md](ENVIRONMENT.md).

Use your own MongoDB (local install or Atlas) by setting `MONGODB_URI` and not running `npm run dev:db`.

## Production build

```bash
npm run build        # web app → apps/web/dist, API bundle → apps/api/dist
SESSION_SECRET=$(openssl rand -hex 32) NODE_ENV=production \
  MONGODB_URI=mongodb://… APP_ORIGIN=https://your.domain npm start
```

The API serves the built web app, so one process answers everything on port 4000. Production refuses to start without a `SESSION_SECRET` of at least 32 characters. See [DEPLOYMENT.md](DEPLOYMENT.md) for HTTPS, reverse proxies and Docker.

## Installing the PWA

Open the app in Chrome, Edge or Safari. Chrome and Edge show an install icon in the address bar (and Settings → App has an install button); on iOS use Share → Add to Home Screen. A service worker is registered on first load; it caches only the app shell, never your data. Production builds only — the dev server does not register one.

## Importing data

1. Download a statement from your bank or card issuer (CSV, Excel, or a text-based PDF) — or use **CSV template** on the Import screen.
2. **Import & Sync → Choose a file.** Check the column mapping, then review each group of rows and confirm.
3. Undo any import from its page if you change your mind.

Spendly never asks for bank, UPI or shopping-app credentials, PINs or OTPs. The only code it ever handles is its own sign-in code, texted to your own number.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `EADDRINUSE` on 4000 / 5173 | Another process uses the port; stop it or set `PORT` (and `server.proxy` target in `apps/web/vite.config.ts`). |
| API cannot reach MongoDB | Check `MONGODB_URI`; with `npm run dev` wait for the `[db] MongoDB ready` line. |
| First `npm run dev` is slow | The MongoDB binary is downloading once. |
| Signed out immediately in production over http | Cookies are `Secure` by default in production; use HTTPS or set `COOKIE_SECURE=false` for local testing only. |
| Uploads fail with “file too large” | Raise `MAX_UPLOAD_MB`. |
| Sign-in says texting codes is not set up | The server has no SMS provider (the production default). Set `SMS_PROVIDER` to `twilio` or `webhook`; for local trials leave `NODE_ENV` unset so the development provider is used. |
