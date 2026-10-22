# Environment variables

Read once at start-up and validated; an invalid value stops the server with a clear message. A `.env` file in `apps/api/` or the repository root is loaded automatically and never overrides real environment variables. `.env.example` is a ready-to-copy template. Secrets are never logged and never sent to the browser.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` turns on secure cookies and requires `SESSION_SECRET`. |
| `PORT` | `4000` | API (and, in production, web) port. |
| `LOG_LEVEL` | `info` | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`. Query strings are never logged. |
| `APP_ORIGIN` | `http://localhost:5173` | Public address of the web app; used for CORS and the CSRF origin check. |
| `CORS_ORIGINS` | `APP_ORIGIN` | Comma-separated allowed origins. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/spendly` | MongoDB connection string. |
| `SESSION_SECRET` | dev-only fixed value | **Required in production**, ≥ 32 random characters. Signs CSRF tokens and keys the hash of sign-in codes. |
| `COOKIE_SECURE` | `true` in production, else `false` | Send cookies over HTTPS only. |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front of the API (`1` behind one), or `loopback`. Needed for correct client IPs and rate limiting. |
| `FORCE_HTTPS` | `false` | Redirect http to https (requires `TRUST_PROXY`). |
| `UPLOAD_DIR` | `.data/uploads` | Where imported files and receipts are stored. Use a persistent volume. |
| `MAX_UPLOAD_MB` | `10` | Maximum upload size (1–100). |
| `WEB_DIST` | auto | Built web app directory; found automatically in a normal checkout. |
| `WORKER_ENABLED` | `true` | Run the background import worker inside the API process. |
| `DEMO_TTL_HOURS` | `24` | Lifetime of demo workspaces; expired ones are purged hourly. |
| `SMS_PROVIDER` | `console` in development, `none` in production | How sign-in codes are delivered: `console` (development only, nothing is sent; the code is logged and shown on screen — refused in production, and it only answers requests from the same machine), `twilio`, `webhook`, or `none` (code sign-in unavailable; the demo workspace still works). |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | — | Required for `twilio`, with `TWILIO_FROM` (a number you own) or `TWILIO_MESSAGING_SERVICE_SID`. |
| `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_SECRET` | — | Required URL for `webhook` (must be `https://` in production). Spendly POSTs `{ to, code, text }` as JSON, with `Authorization: Bearer <secret>` when a secret is set, and treats any 2xx as sent. Use it to bridge to MSG91, Fast2SMS or your own gateway. |
| `SMS_TIMEOUT_MS` | `10000` | Timeout for the SMS provider call (1000–60000). |
| `OTP_TTL_MINUTES` | `5` | How long a code stays valid (1–30). |
| `OTP_RESEND_SECONDS` | `30` | Minimum gap before another code goes to the same number (10–600). |
| `OTP_MAX_ATTEMPTS` | `5` | Wrong tries before a code is cancelled (3–10). |
| `OTP_MAX_SENDS_PER_HOUR` | `5` | Codes per mobile number per hour (1–30). The cap bounds SMS cost and guessing, but it also lets anyone who knows a number use up its quota and delay its owner by up to an hour; raise it if that matters more to you than cost. |
| `AI_PROVIDER` | `none` | `none`, `anthropic` (official SDK) or `openai` (any OpenAI-compatible API). |
| `AI_MODEL` | provider default | Model name. Defaults: Anthropic `claude-opus-5-5`; OpenAI-compatible `gpt-4o-mini`. |
| `AI_API_KEY` | — | Required when `AI_PROVIDER` is not `none`. Never hard-coded anywhere. |
| `AI_BASE_URL` | provider default | Base URL for OpenAI-compatible vendors or local models. NVIDIA's free hosted models: `https://integrate.api.nvidia.com/v1` (see the NVIDIA block in `.env.example`). |
| `AI_EXTRA_BODY` | — | A JSON object of extra fields to send on each chat request, for vendor options (NVIDIA: `{"chat_template_kwargs":{"enable_thinking":false}}` turns off the model's thinking). It cannot set `model`, `messages`, token limits, `stream` or tools. |
| `AI_VISION` | `true` | Set `false` for an endpoint that cannot read images (most hosted open models, including NVIDIA's text models), so receipt photos are never sent to it. |
| `AI_TIMEOUT_MS` | `30000` | Per-request timeout (1000–120000). |
| `AI_MAX_OUTPUT_TOKENS` | `4000` | Output budget (512–16000); thinking tokens share it on current Claude models. |
| `SWIGGY_MCP_URL`, `ZEPTO_MCP_URL`, `ZOMATO_MCP_URL` | `https://mcp.swiggy.com`, `https://mcp.zepto.co.in`, `https://mcp-server.zomato.com` | Where each service's official MCP server lives. Only changed to point at a test double: leaving one set sends account links to it. See *Linking Swiggy and Zepto* in [SETUP.md](SETUP.md). |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | — | Reserved. A Gmail connector is **not implemented**; setting these only changes the status shown on the Import screen. |

## Rate limits (per IP unless noted)

| Limiter | Limit |
| --- | --- |
| General API | 600 / minute |
| Asking for a sign-in code | 10 / 15 minutes per IP, and per number one code every `OTP_RESEND_SECONDS` and `OTP_MAX_SENDS_PER_HOUR` an hour |
| Checking a code | 30 / 15 minutes per IP; `OTP_MAX_ATTEMPTS` wrong tries cancel that code |
| Demo workspace creation | 12 / hour |
| AI endpoints (per user) | 20 / minute |
| File uploads (per user) | 40 / hour |
| Exports and reports (per user) | 30 / hour |
