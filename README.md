# Spendly AI

**Every rupee tracked. Every decision smarter.**

Spendly AI is a private, self-hostable personal-finance web app (installable as a PWA) for people who spend across many Indian platforms — Zomato, Swiggy, Zepto, Blinkit, Instamart, BigBasket, BookMyShow, District, Amazon, Flipkart, Myntra, Uber, Ola, Rapido, IRCTC, subscriptions and more. It brings spending in from the statements and receipts **you** provide, recognises where each rupee went, and lets an evidence-backed AI coach explain the numbers.

## What it does — and what it deliberately does not

| It does | It does not |
| --- | --- |
| Import bank, credit-card and UPI statements (CSV, XLSX, text PDF), receipt emails (.eml) and receipt photos, with a review step before anything is saved | Log in to your bank, UPI app or any shopping account |
| Recognise platforms and categories with a confidence and a reason; learn from your corrections | Scrape accounts, reverse-engineer apps, or ask for your bank’s passwords, PINs or OTPs |
| Track budgets, subscriptions, recurring payments and savings goals | Move, hold or invest any money — goals and budgets are trackers |
| Answer questions about your spending from verified database queries | Let a language model do arithmetic — models may only reword answers, and their text is discarded if it contains a number that is not in your data |
| Show **verified**, **estimated** and **suggested** statements separately, with the calculation behind each | Claim “sync” where no integration exists — the Import screen lists exactly what works today |
| Keep demo data in a separate, clearly labelled demo workspace | Mix sample data into a real account |

## Features

- **Overview** — month-to-date spend against the same days last month, segmented category ring, platform ranking, trends, budget status, recent activity.
- **Transactions** — search, filters, bulk edit, receipts, duplicate resolution, CSV export. Refunds reduce net spending; transfers are never counted.
- **Platforms** — a built-in directory with per-platform spend, 12-month history and a plain statement of how data reaches Spendly; custom platforms; recognition rules with a live tester.
- **Spending Analytics** — trends by day/week/month, split by category or platform, period comparison, weekday and time-of-day patterns, top merchants.
- **AI Money Coach** — plain-English questions, answers with metrics, breakdown, working, coverage and confidence; behavioural insights with evidence; follow-up questions.
- **Budgets** — overall, per-category or per-platform; alerts at levels you choose; run-rate projections clearly labelled as estimates; history; suggestions from your own past months.
- **Recurring payments** — detected from history, confirmed or dismissed by you, with price-change flags and honest confidence.
- **Savings goals** — progress, monthly amount needed, “what if I spend less on X” scenarios.
- **Import & Sync** — column mapping, staged review (ready / check these / duplicates / problems), idempotent confirm, error report, retry, undo.
- **Reports** — eight reports as an on-screen preview, CSV and PDF.
- **Number sign-in** — sign in and sign up with a code texted to your mobile number; no passwords exist to leak. In development the code is shown on screen, clearly labelled.
- **Settings** — theme, time zone, formats, security and sessions, AI permissions and a plain list of what may be sent, notifications, full data export, account deletion.
- **PWA** — installable, works offline for the app shell only (financial data is never cached), update prompt, dark-first with a mint light theme.
- **Typography** — three typefaces to choose from (Jakarta by default) with live previews in Settings.
- **Motion** — springs, count-up figures, drawing charts and a sliding navigation pill throughout; an animated sign-in/sign-up experience. All of it respects reduced-motion settings.

## Quick start

Requirements: Node.js ≥ 22.12 and npm.

```bash
npm install
npm run dev
```

This starts a local MongoDB, the API on <http://localhost:4000> and the web app on <http://localhost:5173>. Open the web app and choose **Try the demo workspace**, or create an account with a mobile number (in development no text is sent — the code appears on screen). See [docs/SETUP.md](docs/SETUP.md) for details.

Production with Docker:

```bash
export SESSION_SECRET=$(openssl rand -hex 32)
docker compose up --build        # http://localhost:4000
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for HTTPS, proxies and backups.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Local MongoDB + API (watch) + web (Vite) together |
| `npm run build` | Builds the web app and the API bundle |
| `npm start` | Runs the built API, which also serves the built web app |
| `npm run typecheck` | TypeScript across all workspaces |
| `npm run lint` | ESLint across the repository |
| `npm run check` | Typecheck + lint |
| `npm run icons` | Regenerates the PWA icons from the logo mark |

## Repository layout

```
apps/web        React 19 + Vite + Tailwind 4 + shadcn/ui PWA
apps/api        Express 5 + Mongoose REST API, import worker, AI service
packages/shared Pure TypeScript shared by both: money, dates, recognition, parsing, schemas, DTOs
docs/           Setup, environment, API, deployment, privacy, architecture, design, integrations
```

## Stack

TypeScript everywhere · React, React Router, TanStack Query, React Hook Form + Zod, Recharts, Lucide · Tailwind CSS 4 + shadcn/ui · Node, Express, Mongoose/MongoDB · pino · Helmet · vite-plugin-pwa (Workbox).

## Documentation

- [Setup](docs/SETUP.md) · [Environment variables](docs/ENVIRONMENT.md) · [API reference](docs/API.md) · [Deployment](docs/DEPLOYMENT.md)
- [Privacy and AI data use](docs/PRIVACY.md) · [Architecture](docs/ARCHITECTURE.md) · [Design system](docs/DESIGN.md) · [Integrations](docs/INTEGRATIONS.md)

## Automated tests

This repository intentionally contains **no automated test files**, at the project owner’s request. Quality is checked with strict TypeScript (`npm run typecheck`), ESLint (`npm run lint`), production builds, and manual end-to-end runs of the API and the UI.

## Credits and licences

Fonts: Plus Jakarta Sans, Sora, Geist, Manrope and Bricolage Grotesque (SIL Open Font License), self-hosted. Brand glyphs come from the Simple Icons dataset (CC0); the brands’ names and logos are trademarks of their owners and appear only to identify the platform a transaction belongs to. Spendly AI is not affiliated with or endorsed by any of them.
