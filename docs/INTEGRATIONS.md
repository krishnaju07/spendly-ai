# Integrations and data sources

Spendly only uses data **you hand to it**. It never logs in to your accounts, never asks for the passwords, PINs or OTPs of your bank or any other service, and never scrapes or reverse-engineers an app or website. (The one code it sends is its own sign-in code, texted to your own number.) The Import screen shows this same table, live, from `GET /api/v1/integrations`.

| Source | Status | How it works |
| --- | --- | --- |
| Bank / credit-card statements (CSV, XLSX) | **Available** | Upload, map columns (suggested automatically), review, confirm |
| Text-based PDF statements | **Available** | Rows are read heuristically; check the preview. Scanned PDFs have no text and are refused with a clear message |
| UPI exports | **Available** | Same as statements; UPI narrations are parsed for the merchant |
| Receipt emails | **Available** | Save the email as `.eml` and upload it; amount, date and sender are read locally |
| Receipt photos | **Available, AI optional** | Stored privately. With a provider configured **and** the user’s permission, the image is read by AI; otherwise you fill in merchant, date and total yourself |
| Manual entry | **Available** | Add transactions by hand; platform and category are auto-detected |
| Gmail receipt sync | **Not implemented** | Would need a Google OAuth client and explicit consent. Use `.eml` upload instead |
| Bank sync (Account Aggregator) | **Unavailable** | Requires registration as a financial-information user; not possible in a self-hosted build |
| Zomato, Swiggy, Zepto, Blinkit, BookMyShow, District, … | **No public API** | These services publish no API for a customer’s own order history. Their spending is recognised from bank/UPI statements and receipts |

## Sign-in codes (SMS)

Sign-in is by a code texted to the user’s mobile number, so a server needs a way to send texts. `SMS_PROVIDER` selects it (see [ENVIRONMENT.md](ENVIRONMENT.md)):

| Provider | Status | Notes |
| --- | --- | --- |
| `console` | Development only | Sends nothing; prints the code and shows it on the sign-in screen, labelled. Refused in production, and it only serves requests from the same machine, so a server left in development mode on the internet cannot hand codes to strangers |
| `webhook` | Generic | Spendly POSTs `{ to, code, text }` to a gateway you run. Exercised against a local listener while building; use it to bridge to MSG91, Fast2SMS or any HTTP SMS API |
| `twilio` | Written to Twilio’s public Messages API | **Not run against a live Twilio account** in the environment where this was written; send a test code to your own number before relying on it |
| `none` | Default in production | Code sign-in is reported as unavailable; the demo workspace still works |

Adapters live in `apps/api/src/services/sms.ts`; adding one means implementing `send(to, code)` and registering it in `getSmsProvider()`.

## Platform directory

The built-in directory (`packages/shared/src/catalog/platforms.ts`) lists each platform with its group, colours, aliases, recognition patterns (with confidence and reason), default category and an honest `sources` block saying which of the routes above can bring its data in. Legal-entity and former names (for example Swiggy’s “Bundl Technologies”) are matched with lower confidence and flagged for a one-time confirmation. Users can add **custom platforms** and **rules** in the app.

### Adding a platform

1. Add an entry to `PLATFORMS` with a stable `slug`, `aliases`, `patterns` and `sources`.
2. Optionally add a brand glyph in `apps/web/src/lib/brand-icons.ts` (from Simple Icons); without one a monogram is shown.
3. Run `npm run typecheck`. Existing transactions pick it up through **Platforms → Recognition rules → Apply to existing**.

## Adding an import format

Readers live in `apps/api/src/imports/readers.ts`. A new tabular format needs a reader returning rows plus notes, and header synonyms in `SYNONYMS` for column suggestion. Bank-specific narration quirks belong in `packages/shared/src/narration.ts`, next to the UPI/POS/NEFT/IMPS parsers.

## Adding an AI provider

Providers implement one small interface in `apps/api/src/ai/providers.ts`: `LlmProvider` with `complete(request)` and a `supportsVision` flag (requests may carry an image for receipt reading). Everything the app asks of a model is optional, so a text-only provider is fine. Register it in `getProvider()` and add its name to the `AI_PROVIDER` enum in `config/env.ts`. Keys come only from the environment.
