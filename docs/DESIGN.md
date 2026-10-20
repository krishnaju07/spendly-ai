# Design system

The visual direction comes from the reference screens supplied with the project: a dark-first, iOS-style fintech UI with large rounded cards, white pill actions, very large numerals with the currency sign and paise dimmed, a segmented ring chart, circular merchant logos, date-grouped lists on a sheet that slides over the hero figure, and a floating pill navigation. The **light theme** follows the mint-and-black reference.

## Principles

1. **The number is the hero.** Amounts are set large; `₹` and the paise are dimmed so the rupees are what the eye lands on. Prose rounds to whole rupees from ₹1,000; tables keep exact paise.
2. **Honesty is visible.** Verified facts, estimates and suggestions carry different badges. Confidence is always a label and a figure. Demo data is always labelled. Status is never colour alone — every chip has an icon and words.
3. **Calm density.** Generous radius (24–32 px), soft surfaces, one primary action per view, hairline borders.
4. **One accessible baseline.** Every interactive control is keyboard reachable with a visible focus ring; every chart has a table twin; contrast targets WCAG AA in both themes.

## Tokens (`apps/web/src/index.css`)

| Group | Tokens |
| --- | --- |
| Surface | `--background`, `--card`, `--popover`, `--muted`, `--accent`, `--tile` (stat tiles) |
| Ink | `--foreground`, `--muted-foreground`, `--primary` / `--primary-foreground` (white pill on dark, black on mint) |
| Inverse sheet | `--sheet`, `--sheet-foreground`, `--sheet-muted`, `--sheet-border` — white over dark, black over mint (`.sheet-surface`) |
| Status | `--ok`, `--warn`, `--bad` and `*-soft` fills; `--status-warning`, `--status-serious`, `--status-critical` for meters and the demo banner |
| Categorical data | `--series-1 … --series-8` plus `--series-other`; chart furniture `--chart-grid`, `--chart-axis`, `--chart-muted`; one sequential ramp `--chart-ramp-1 … 7` |
| Shape and depth | `--radius`, `shadow-card`, a faint film grain (`.grain`) and ambient violet/mint glows on hero surfaces |

Theme is `dark` by default, `light`, or `system`; it is applied with a class on `<html>` before first paint to avoid a flash.

## Typography

All sans-serif, in three switchable typefaces (**Settings → Appearance → Typeface**; a per-device choice kept in the browser and applied before first paint). Each is a *pairing*: one face for UI text and one for headings and figures.

| Typeface | UI text | Headings and figures | Feel |
| --- | --- | --- | --- |
| **Jakarta** (default) | Plus Jakarta Sans | Plus Jakarta Sans, extra-bold | Warm, rounded, very readable |
| Studio | Geist | Sora | Crisp, confident, a little technical |
| Grotesk | Manrope | Bricolage Grotesque | Characterful, modern |

There is deliberately no serif: long sentences and money figures read best in a clean sans, so even the sign-in headline and the coach's answers use the heading face.

How it works: `index.css` defines runtime variables per pairing — `--ui-font`, `--heading-font`, weights `--w-heading` / `--w-title`, and tracking `--tr-hero|xl|lg|title` — on `:root` (Jakarta) and on `[data-typeface='…']`. Components use the semantic classes `type-hero`, `type-xl`, `type-lg`, `type-title`, `type-headline` (a sentence set as a headline) and `type-mark` (the wordmark) instead of naming a font, so one attribute on `<html>` restyles the whole app. A preview card can carry the attribute too.

Details: tabular figures (`.tnum`) wherever columns must line up; `₹` and the paise are dimmed; headings use `text-wrap: balance` and paragraphs `pretty`; faux bold/italic is disabled (`font-synthesis: none`). All fonts are self-hosted (Latin and Latin-extended subsets; the rupee sign lives in Latin-extended) under the SIL Open Font License. Only the default font is precached by the service worker; the others download when chosen and are then cached.

## Charts

- The eight categorical hues were validated for colour-blind separation and contrast on both surfaces. Each category prefers its own slot so “Food delivery” is the same orange everywhere; when two categories in one chart want the same slot the lower-ranked one takes the next free slot **for that chart only**. A ninth series is never invented — it folds into **Other**.
- Marks are thin: bars ≤ 24 px with a 4 px rounded data end, 2 px lines, a 2 px gap in the surface colour between stacked fills, markers ≥ 8 px. Grids are hairlines and axes are muted; text never takes a series colour.
- Two or more series always get a legend; no dual axes; hover/focus gives a tooltip; clicking a mark drills into the matching transactions; while data refetches, the previous chart stays on screen, dimmed.

## Components

Built on shadcn/ui primitives restyled to the system: pill buttons, segmented controls, chips with icons, circular platform logos (a brand glyph on the brand colour, or a monogram, or a category icon), money display, the segmented ring, bottom-sheet drawers on phones and side sheets on desktop, a floating pill bottom navigation with a mint action button, a command palette (⌘K / Ctrl+K), and skeleton, empty and error states that say what happened and offer the way out.

## Responsive behaviour

Mobile-first. Below 768 px the sidebar becomes a floating pill bar (Home, Activity, Coach, More) with a round add button; **More** opens a grid of the remaining pages. Wide tables become stacked rows; tab lists scroll sideways; grids shrink instead of widening the page. Sticky elements (sidebar, top bar, toasts) offset themselves below the demo banner using `--banner-h`.

## Motion

Motion explains what changed and makes the app feel alive; it never carries information on its own, and `prefers-reduced-motion` collapses all of it to the finished state. Almost everything animates `transform` and `opacity`; the few exceptions (stroke drawing, a travelling gradient border, blur on headline words, a width fill) are on small areas. The tokens and keyframes live at the end of `apps/web/src/index.css`.

| Piece | What it does |
| --- | --- |
| Easing | `--ease-out` for entrances; `--spring-soft` and `--spring-bouncy` are damped springs written as CSS `linear()` curves |
| Page and sections | Each route eases in (`.page-enter`, keyed by path so filter changes do not replay it); `.stagger` on a container makes its children rise one after another |
| Sliding pill | `useActivePill` + `.pill-host`: one pill glides behind the active item in the sidebar, the mobile pill nav, segmented controls and tabs |
| Numbers | `Money` (large sizes) and `CountUp` count up on first paint and from the old value on change |
| Charts | Bars grow from the baseline, lines draw in with a soft area fill, the ring's arcs draw in and redraw smoothly, sparklines draw themselves, progress bars fill |
| Details | Skeleton shimmer, a sheen across primary buttons on hover, chips that pop in, a soft ping on the unread-notification dot, hover lift on link cards |

### Sign in and sign up

One page (`/login` and `/register` share a component, so the left scene keeps playing while the card morphs):

- **Stage:** a segmented ring that draws itself, platforms orbiting it, an odometer that rolls through sample amounts, a live feed of sample transactions arriving, and a coach note — all labelled “Illustration with sample figures”. A marquee ribbon lists the platforms Spendly recognises.
- **Backdrop:** slow aurora blobs, a drifting dot grid and a light that follows the pointer; parallax moves the stage a few pixels against the pointer (mouse and pen only).
- **Card:** glass with a border beam travelling around the edge and a gentle tilt toward the pointer, then three steps that slide past each other. **Number:** a floating-label field with a fixed +91 (typed, pasted or autofilled numbers are tidied to `98765 43210`). **Code:** six boxes that are really one invisible input, so paste, the keyboard’s “code from Messages” suggestion, backspace and screen readers behave normally; digits pop in, a wrong code shakes and clears, a right one ripples green; a resend countdown runs underneath. **Name:** asked only for a number Spendly has not seen. Beside them: a clearly labelled *Development mode* note (and the code, with a “Use it” button) when no SMS is sent, an honest “not set up” note when the server has no SMS provider, a call-to-action that morphs from label to spinner to check, and a shake for mistakes.
- **Leaving:** on success the card sinks, the stage swells and fades, and the app takes over with a view transition where the browser supports it.

## Third-party assets

- **Fonts:** Plus Jakarta Sans, Sora, Geist, Manrope and Bricolage Grotesque — SIL Open Font License 1.1.
- **Brand glyphs:** path data from the [Simple Icons](https://simpleicons.org) dataset (CC0). Brand names and logos are trademarks of their owners, used only to identify a platform in the user’s own data. No endorsement is implied. Platforms without a published glyph use a monogram.
- **Icons:** Lucide (ISC). **UI primitives:** shadcn/ui and Radix (MIT).
