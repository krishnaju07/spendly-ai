# API reference

Base path: `/api/v1`. JSON in, JSON out. All money is **integer paise** (₹1 = 100 paise); all instants are ISO 8601 strings; calendar days are `YYYY-MM-DD` in the user’s time zone.

## Conventions

**Envelope.** Success: `{ "data": … }`. Failure: `{ "error": { "code", "message", "details?", "requestId" } }` with a stable `code` (`VALIDATION_ERROR`, `UNAUTHORIZED`, `INVALID_CODE`, `CODE_EXPIRED`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, …). Every response carries `X-Request-Id`.

**Authentication.** Sign in with a code texted to a mobile number: `POST /auth/otp/request`, then `POST /auth/otp/verify` (which also creates the account the first time a number signs in). `POST /auth/demo` starts a demo workspace. There are no passwords. The server sets an HttpOnly, SameSite=Lax session cookie `sid` (a random token; only its hash is stored) and a readable `csrf` cookie. Sessions last 30 days of activity (demo workspaces: until they expire).

**CSRF.** Every non-GET request must send `X-Spendly-Client: web` and `X-CSRF-Token` (the value from `GET /auth/me` → `csrfToken`, or the `csrf` cookie). The token is an HMAC bound to the session.

**Tenant isolation.** Every query is scoped to the signed-in user’s id; ids belonging to someone else behave as `404`.

**Ranges.** Range-aware endpoints accept `preset` (`today`, `yesterday`, `last_7_days`, `last_30_days`, `last_90_days`, `this_week`, `last_week`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`, `last_year`, `this_fy`, `last_fy`, `last_12_months`) **or** `from` + `to`. Without either, the user’s default range applies. Responses include the resolved `range` and a like-for-like `baseline` (month-to-date is compared with the same days of the previous month).

**Filters** (comma-separated, `none` means unassigned): `category`, `platform`, `paymentMethod`, `type`, `status`.

**Pagination:** `page` (≥ 1), `pageSize` (1–100, default 25) → `{ items, meta: { page, pageSize, total, totalPages } }`.

**What counts as spending.** Completed expenses minus linked refunds. Transfers, pending, failed and reversed transactions are excluded; income is reported separately.

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | `{ status, database, time }`; `503` when the database is down. Not authenticated. |

## Auth

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/auth/config` | `{ otp: { delivery, length, resendSeconds, expiresMinutes } }` where `delivery` is `sms`, `dev` (nothing is sent; the code is returned and shown on screen) or `unavailable` (no SMS provider). Not authenticated. |
| POST | `/auth/otp/request` | `{ phone }` → texts a 6-digit code → `{ resendInSeconds, expiresInSeconds, devCode? }` (`devCode` only when `delivery` is `dev`). The answer is the same whether or not the number has an account. Errors: `SMS_NOT_CONFIGURED` (503), `CODE_COOLDOWN` and `CODE_LIMIT` (429, `details.retryAfterSeconds`), `SMS_SEND_FAILED` (502). |
| POST | `/auth/otp/verify` | `{ phone, otp, name? }` → `{ status: "signed_in", isNew, user, preferences, csrfToken }` (201 when the account was just created), or `{ status: "needs_name" }` when the code is right but the number is new: send the same code again with `name` (it stays valid for about 10 minutes). Errors: `INVALID_CODE` (400, `details.attemptsLeft`), `CODE_EXPIRED` (400), `CODE_LOCKED` (429). |
| POST | `/auth/demo` | Creates an isolated, labelled demo workspace with sample data |
| POST | `/auth/logout` | |
| GET | `/auth/me` | `{ user, preferences, csrfToken }` |
| GET | `/auth/sessions` · DELETE `/auth/sessions/:id` | Devices signed in; revoke one |

`phone` is an Indian mobile number: ten digits starting 6–9, optionally written with `+91`, `91` or `0` in front and spaces or dashes inside. It is stored as E.164 (`+919876543210`).

## Dashboard and analytics

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/dashboard/summary` | Range + filters. Totals, change vs baseline, budget, savings estimate, top platforms, review/duplicate counts |
| GET | `/dashboard/trends` | Range + filters + `granularity` (`day`/`week`/`month`), `months` |
| GET | `/dashboard/month-over-month` | Cumulative spend this month vs last |
| GET | `/dashboard/budget-vs-spend` | Monthly spend against the overall budget |
| GET | `/dashboard/patterns` | Weekday and time-of-day patterns |
| GET | `/analytics/platforms` · `/analytics/categories` | Stats with previous-period comparison |
| GET | `/analytics/trends` | + `granularity`, `groupBy` (`none`/`category`/`platform`; top six + Other) |
| GET | `/analytics/compare` | + optional `compareFrom`, `compareTo` for a custom baseline |
| GET | `/analytics/patterns` | Hour-of-day uses only transactions that carry a time |
| GET | `/analytics/merchants` | + `limit` (≤ 50) |

## Transactions

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/transactions` | Range + filters + paging + `q`, `sort` (`date`/`amount`/`merchant`), `order`, `tag`, `needsReview`, `duplicates`, `recurring`, `importJob` |
| POST | `/transactions` | Platform and category are auto-detected when omitted; the response says when a rule is worth remembering |
| GET | `/transactions/:id` · PATCH · DELETE | |
| POST | `/transactions/bulk` | `{ action, ids (≤ 500), … }`: `categorize`, `set_platform`, `set_type`, `add_tag`, `delete`, `confirm_classification` |
| GET | `/transactions/export` | CSV (UTF-8 with BOM), same filters |
| GET | `/transactions/duplicates` · POST `/transactions/duplicates/resolve` | Groups of possible duplicates; `{ keepId, removeIds }` deletes the extras, `dismiss: true` marks the group “not a duplicate” |
| POST · GET · DELETE | `/transactions/:id/receipt` | PNG, JPEG, WebP or PDF up to 8 MB, type-checked by content, not by file name |

## Imports

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/imports` | multipart `file` (+ optional `kind`). CSV, XLSX, PDF, .eml, PNG/JPEG/WebP. Magic-byte sniffing, zip-bomb guard |
| GET | `/imports` · `/imports/:id` | Job with status, progress, stats, columns and sample rows |
| GET | `/imports/:id/preview` | Re-read for another `sheet` / `headerRow` with a fresh mapping suggestion |
| PUT | `/imports/:id/mapping` | Column mapping → starts background processing |
| GET | `/imports/:id/records` | `status` (`valid`/`invalid`/`duplicate`/`uncertain`), `decision`, `q`, paging |
| PATCH | `/imports/:id/records/:rid` | Accept / reject, or edit a row (an edited row is re-validated and accepted) |
| POST | `/imports/:id/records/bulk` | Accept or reject every row of a status |
| POST | `/imports/:id/confirm` | `{ pending?: "skip" | "import", learnConfirmed? }` — `409 PENDING_DECISIONS` if duplicates are undecided |
| POST | `/imports/:id/retry` · `/imports/:id/rollback` | Retry failed rows; remove everything the import created |
| DELETE | `/imports/:id` | Removes the file and review list; imported transactions stay |
| GET | `/imports/:id/errors.csv` | Every rejected row with its reason |

Job statuses: `uploaded`, `needs_mapping`, `queued`, `processing`, `ready_for_review`, `importing`, `completed`, `completed_with_errors`, `failed`, `cancelled`. Confirming is idempotent: a unique index on `(importJobId, importRowNumber)` means a retry can never create a transaction twice.

## Platforms, categories, rules

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/platforms/directory` | Directory only, no stats (cheap; cached by the client) |
| GET | `/platforms` · `/platforms/:slug` | With spend stats, sparkline, 12-month history, insights |
| POST · PATCH · DELETE | `/platforms`, `/platforms/:slug` | Custom platforms only |
| GET · POST · PATCH · DELETE | `/categories` | Custom categories; deleting one flags its transactions for review |
| GET · POST · PATCH · DELETE | `/rules` | Match types `exact`, `contains`, `starts_with`, `regex` (validated against catastrophic patterns) |
| POST | `/rules/preview` | Dry run: what the rules and directory make of a merchant/description |
| POST | `/rules/reapply` | Re-classify machine-classified transactions; never touches ones you set yourself |

## Planning

| Method | Path | Notes |
| --- | --- | --- |
| GET · POST | `/budgets` | Progress, level (`ok`/`warning`/`exceeded`), run-rate projection (labelled estimate) |
| PATCH · DELETE | `/budgets/:id` | |
| GET | `/budgets/suggestions` · `/budgets/:id/history` | |
| GET | `/recurring-payments` | Detects on first call; `POST /recurring-payments/detect` re-scans; `PATCH /recurring-payments/:id` confirms, dismisses or adjusts |
| GET · POST | `/savings-goals` | |
| PATCH · DELETE | `/savings-goals/:id` | |
| POST · DELETE | `/savings-goals/:id/contributions[/:cid]` | Records money you set aside; nothing moves |
| GET | `/savings-goals/:id/scenario` | `category`, `reducePct`, `plannedMonthly` → estimated effect on the finish date |

## AI

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/ai/status` | Provider, whether it is active for you, and the exact `sends` / `neverSends` lists |
| POST | `/ai/chat` | `{ message, previousPlan? }` → a coach answer: headline, metrics, breakdown, calculation, coverage, confidence, statements (`verified` / `estimate` / `suggestion`) |
| GET | `/ai/insights` · POST `/ai/insights/refresh` · PATCH `/ai/insights/:id` | Behavioural insights with evidence; dismiss |

## Reports

`GET /reports/types` lists them. `GET /reports/:type` with `type` one of `monthly-spending`, `yearly-spending`, `platform-comparison`, `category-analysis`, `subscriptions`, `budget-performance`, `spending-changes`, `ai-summary`; range parameters as above and `format=json|csv|pdf`.

## Account

| Method | Path | Notes |
| --- | --- | --- |
| GET · PATCH | `/settings/preferences` | Theme, time zone, formats, default range, income tracking, AI permissions, notifications |
| GET | `/settings/export` | Everything stored about you as JSON (streamed) |
| DELETE | `/settings/account` | `{ otp, confirm: "DELETE" }` — `otp` is a fresh sign-in code texted to the account's number (request it with `/auth/otp/request`; the demo workspace needs none); removes all data and files |
| GET | `/notifications` · POST `/notifications/read-all` · PATCH `/notifications/:id/read` · DELETE `/notifications/:id` | |
| GET | `/integrations` | Honest status of every import/sync option |
