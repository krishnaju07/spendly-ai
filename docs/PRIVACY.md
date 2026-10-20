# Privacy, security and AI data use

Spendly AI is built so that your financial data stays in your own database. This page states exactly what is stored, what can leave the server, and what protects it.

## What is stored

| Data | Where | Retention |
| --- | --- | --- |
| Account: name and mobile number (there is no password) | MongoDB | Until you delete the account |
| Sign-in codes: a keyed hash of the code, the number it was sent to, a try counter | MongoDB | Valid for 5 minutes, removed within the hour |
| Transactions, budgets, goals, rules, recurring payments, insights, notifications, preferences | MongoDB | Until you delete them or the account |
| Uploaded statements, receipts and photos | `UPLOAD_DIR` on the server | Until you delete the import / receipt / account |
| Sessions: a hash of the session token, device description, IP, last activity | MongoDB | 30 days of inactivity, or until sign-out |
| Demo workspace and its sample data | MongoDB (flagged `isDemo`) | Deleted automatically after `DEMO_TTL_HOURS` (24 h) |

Spendly never asks for or stores bank, card, UPI or shopping-app **credentials, PINs or OTPs** — it has no field that asks for them, and the Import screen says so. The only one-time code it handles is its own sign-in code, sent to your own mobile number. Amounts are exact integers (paise); nothing is estimated silently.

## AI: what is sent and when

The app works fully with AI **off**, which is the default. A provider is only used if the server administrator configures one (`AI_PROVIDER`, `AI_API_KEY`) **and** a user turns it on in Settings → AI & privacy. Each use is a separate permission, off until chosen. The Settings screen and `GET /api/v1/ai/status` list exactly what applies to that user right now.

**A language model never calculates.** A question is turned into a structured plan, the plan runs as database queries, and the result is a set of verified figures. A model may only reword that answer; its text is discarded if it contains any number that is not among the verified figures, and the deterministic answer is shown instead.

| Permission | What may be sent to the provider |
| --- | --- |
| *Use AI* (master switch) | The text of the question you type into the coach, with account numbers, emails and phone numbers masked first; Spendly-computed totals, counts, percentages, date ranges and category names for that question |
| *Let AI see merchant names* | Platform and merchant names appearing in those results. **Off** (default): names are replaced by neutral labels such as “Platform A” before sending and restored locally afterwards |
| *Help classify unknown merchants* | Only the merchant text of statement rows the built-in rules could not recognise, masked, with no amounts or dates |
| *Read receipt photos* | The receipt image you choose to read |

**Never sent, whatever you choose:** individual transactions, descriptions, notes or tags (other than merchant text under the classification permission); your name, mobile number, session or any bank / card / UPI credentials; your full transaction history.

Where the data goes is decided by `AI_PROVIDER` / `AI_BASE_URL`: the vendor you configure (or a model you host yourself via an OpenAI-compatible endpoint). Spendly adds no other third party.

## Security measures

- **Authentication:** there are no passwords to steal or reuse. You sign in with a six-digit code texted to your mobile number. A code expires after 5 minutes, is stored only as a keyed hash, is cancelled after 5 wrong tries, and can be asked for once every 30 seconds and 5 times an hour per number; the reply never reveals whether a number already has an account. Sessions are server-side (random token, only its hash stored, HttpOnly + SameSite=Lax cookie, Secure in production). Deleting an account needs a fresh code.
- **What number sign-in does not protect against:** a six-digit code is short, so the limits above are what protect it, and whoever controls your phone number (a SIM swap) or can read your text messages can sign in as you. There is no second factor yet; keep your SIM protected with your operator.
- **CSRF:** a custom header plus a session-bound HMAC token on every state-changing request.
- **Isolation:** every query is scoped to the signed-in user; demo workspaces are separate users that cannot reach real data.
- **Transport and browser:** strict Content-Security-Policy (`default-src 'self'`, no inline scripts, no framing), HSTS, `nosniff`, `Referrer-Policy: no-referrer`, CORS limited to configured origins.
- **Abuse limits:** per-IP and per-user rate limits (see [ENVIRONMENT.md](ENVIRONMENT.md)); request validation with Zod on every endpoint.
- **Uploads:** size limits, content (magic-byte) type checks, a decompression-bomb guard for spreadsheets, files stored under random names.
- **Rules:** user-supplied regular expressions are checked for catastrophic backtracking before they are saved.
- **Logs:** structured, with cookies, authorization headers, mobile numbers and codes redacted and query strings never logged. (The development-only `console` provider prints the code on purpose; it is refused in production.)
- **Service worker:** caches the app shell only; financial data and API responses are never cached on the device.

## Your controls

- **Export:** Settings → Your data → full JSON export, and transactions as CSV, at any time.
- **Delete:** Settings → Your data → delete the account (confirmed with a fresh code); everything above, including uploaded files, is removed.
- **Sessions:** see and sign out devices.
- **AI:** switch it off entirely, or per capability, at any time.

## For operators

You are responsible for the database, backups, TLS, the AI vendor’s terms and the SMS provider’s. If you enable AI, tell your users which vendor receives data and link them to this page. Your SMS provider (Twilio, or whatever your webhook forwards to) sees each user’s mobile number and the code sent to it, so name it in your own privacy notice. This software provides budgeting guidance based on a person’s own data; it is not professional investment, tax or legal advice.
