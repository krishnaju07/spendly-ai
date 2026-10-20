# Architecture

```
┌──────────────┐   /api/v1 (JSON, cookies)   ┌───────────────────────────────┐   ┌─────────┐
│  apps/web    │ ───────────────────────────▶ │  apps/api (Express 5)         │──▶│ MongoDB │
│  React PWA   │ ◀─────────────────────────── │  routes → services → models   │   └─────────┘
└──────┬───────┘                              │  import worker · AI service   │──▶ uploads/ (files)
       │ imports types, schemas, logic        └──────────────┬────────────────┘
       ▼                                                     │ optional, opt-in
┌──────────────────┐                                         ▼
│ packages/shared  │ money · dates · recognition · parsing   AI provider (Anthropic SDK or
│ (pure TypeScript)│ · insights · coach plans · Zod · DTOs   OpenAI-compatible endpoint)
└──────────────────┘
```

The shared package has no I/O. Anything that decides a number — range maths, net spend, recognition, duplicate detection, projections, insight detectors — lives there, so the API and the UI cannot disagree.

## Money and time

- Money is an **integer number of paise** end to end. Parsing is string-based (`"1,249.50"`, `"₹350/-"`, `"Rs. 1,24,950.00 Dr"` never pass through floats); formatting uses Indian digit grouping. Only `completed` transactions count; **net spend = purchases − linked refunds**; transfers never count; income is separate.
- Ranges are resolved in the user’s time zone (default Asia/Kolkata), including Indian financial years. Comparisons are like-for-like: month-to-date against the same days of last month.

## Platform recognition (`packages/shared/src/recognition.ts`)

1. Normalise text and parse bank narrations (UPI / POS / NEFT / IMPS) into merchant, VPA, channel and person-to-person hints.
2. Apply **user rules** and **learned rules** (highest priority, validated regexes).
3. Match the **directory**: exact aliases (0.97), specific patterns (0.96–0.97), then legal-entity and former names flagged *probable* (0.68). Ambiguous tokens (“BMS”, “District”) stay below 0.5 and are suggested, never silently assigned.
4. Fall back to keyword categories; anything under 0.7 is marked **needs review**.
5. Optionally, unresolved merchants go to the AI provider (only if enabled and permitted).

Each result carries a `source`, `confidence` and a human `reason`, shown wherever a classification appears. Correcting one offers a rule and learns from confirmations.

## Imports (`apps/api/src/imports`)

`upload → sniff & read → (mapping) → stage rows → review → confirm → import`

- Readers: CSV (encoding and delimiter detection), XLSX (sheets, header-row detection), text PDFs, `.eml`, receipt images.
- Rows become staged **ImportRecords** classified `valid`, `invalid`, `duplicate` or `uncertain`; duplicates are found with multiset fingerprints plus fuzzy matching; refunds are linked to their purchases.
- Work runs in a MongoDB-backed queue with atomic claims and a cursor, in batches, so it resumes after a restart. Confirmation is **idempotent** through a unique partial index on `(importJobId, importRowNumber)`. A finished import can be rolled back.

## AI Money Coach

`question → QueryPlan (deterministic parser, LLM only as a fallback that sees just the question) → database queries → verified CoachAnswer → optional rewording`

The answer lists metrics, breakdown, calculation steps, data coverage and a confidence level, and tags every statement **verified**, **estimate** or **suggestion**. Reworded text is checked by a numeric validator against the verified figures. Names can be masked reversibly before anything leaves the server (see [PRIVACY.md](PRIVACY.md)).

## Backend layout (`apps/api/src`)

| Folder | Role |
| --- | --- |
| `config/` | Environment parsing and validation |
| `middleware/` | request context, auth/CSRF, validation, rate limits, error mapping |
| `models/` | Mongoose schemas (account, finance, planning, imports) |
| `services/` | Business logic: queries, analytics, budgets, recurring, goals, insights, coach, reports, PDF |
| `imports/` | readers, pipeline, worker |
| `ai/` | provider interface + adapters, consent gate, masking, validator |
| `routes/` | Thin HTTP layer, versioned under `/api/v1` |

Requests flow `route → validate (Zod) → service → model`; every query carries the user id.

## Frontend layout (`apps/web/src`)

| Folder | Role |
| --- | --- |
| `pages/` | One file per screen, lazy-loaded |
| `components/ui/` | shadcn/ui primitives, restyled to the design system |
| `components/common`, `charts`, `layout`, feature folders | Shared building blocks and per-feature UI |
| `hooks/` | auth, theme, catalog, media queries, install prompt |
| `lib/` | API client, URL-driven filters, formatting, labels |

State: server data lives in TanStack Query (keyed by range + filters); the **date range and filters live in the URL**, so every chart click, shared link and back button reproduces the same view. Forms use React Hook Form with Zod. Every chart has a “view as table” twin.

## PWA

`vite-plugin-pwa` (Workbox `generateSW`): the app shell is precached, `/api/*` is excluded and nothing is runtime-cached. Updates are prompt-based. The manifest includes maskable icons and shortcuts (add a transaction, import, coach).
