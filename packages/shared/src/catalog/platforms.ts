/**
 * The platform directory. Every mapping here is a *heuristic* for recognising where money went —
 * none of these services expose a public API for a consumer's personal spending history, and the
 * app never claims otherwise. Data arrives through statements, CSV/XLSX exports, receipts and
 * manual entry; this catalog only teaches the recognition engine what the narrations look like.
 *
 * Patterns run against NORMALISED text (upper-case A–Z/0–9 separated by single spaces).
 */

export const PLATFORM_GROUPS = [
  'Food delivery',
  'Quick commerce & groceries',
  'Entertainment & events',
  'Shopping',
  'Travel & transport',
  'Subscriptions & digital',
  'Other',
] as const;
export type PlatformGroup = (typeof PLATFORM_GROUPS)[number];

export interface PlatformPattern {
  /** RegExp source, tested against normalised text. */
  source: string;
  confidence: number;
  reason: string;
  /** Overrides the platform's default category (e.g. "Zomato Gold" is a subscription). */
  category?: string;
  subcategory?: string;
}

export interface PlatformSources {
  manual: boolean;
  csv: boolean;
  bankStatement: boolean;
  /** The .eml receipt importer recognises mail from this sender. */
  emailReceipts: boolean;
  officialApi: 'none' | 'partner_only';
  note: string;
}

export interface PlatformDef {
  slug: string;
  name: string;
  group: PlatformGroup;
  /** "general" entries are buckets for offline spending (restaurants, rent, fuel …), not brands. */
  kind: 'brand' | 'general';
  /** Tile colour — brand-adjacent, used for the logo tile only (charts use the validated palette). */
  color: string;
  textColor: string;
  monogram: string;
  /** simple-icons slug, when a glyph exists. The web app resolves it; otherwise the monogram is used. */
  brandIcon?: string;
  /** lucide icon for general buckets. */
  icon?: string;
  category: string;
  subcategory?: string;
  website?: string;
  emailDomains?: string[];
  /** Exact normalised merchant strings (corporate suffixes already removed). */
  aliases: string[];
  patterns: PlatformPattern[];
  verification: 'verified' | 'probable';
  sources: PlatformSources;
  note?: string;
}

/** Legal-entity and former-name matches: applied, but flagged so the user can confirm them once. */
const PROBABLE = 0.68;

const NO_API =
  'No public API exposes personal order history. Import your bank or UPI statement, a CSV/XLSX export, or receipt emails instead.';

function sources(emailReceipts: boolean, note = NO_API): PlatformSources {
  return { manual: true, csv: true, bankStatement: true, emailReceipts, officialApi: 'none', note };
}

const GENERAL_NOTE =
  'A bucket for offline or one-off spending. Recognised from keywords in the merchant text; edit or add rules to tune it.';

export const PLATFORMS: readonly PlatformDef[] = [
  // ── Food delivery ────────────────────────────────────────────────────────────────────────
  {
    slug: 'zomato',
    name: 'Zomato',
    group: 'Food delivery',
    kind: 'brand',
    color: '#E23744',
    textColor: '#FFFFFF',
    monogram: 'Z',
    brandIcon: 'zomato',
    category: 'food-delivery',
    subcategory: 'Restaurant orders',
    website: 'https://www.zomato.com',
    emailDomains: ['zomato.com'],
    aliases: ['ZOMATO', 'ZOMATO ONLINE ORDER', 'ZOMATO ORDER', 'ZOMATO FOOD ORDER', 'ZOMATO MEDIA'],
    patterns: [
      {
        source: '\\bZOMATO ?(GOLD|PRO)\\b',
        confidence: 0.97,
        reason: 'Zomato Gold/Pro is a membership, not a food order',
        category: 'subscriptions',
        subcategory: 'Memberships',
      },
      { source: '\\bZOMATO\\b', confidence: 0.96, reason: 'Merchant text contains "Zomato"' },
    ],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'swiggy',
    name: 'Swiggy',
    group: 'Food delivery',
    kind: 'brand',
    color: '#FC8019',
    textColor: '#FFFFFF',
    monogram: 'S',
    brandIcon: 'swiggy',
    category: 'food-delivery',
    subcategory: 'Restaurant orders',
    website: 'https://www.swiggy.com',
    emailDomains: ['swiggy.in', 'swiggy.com'],
    aliases: ['SWIGGY', 'SWIGGY ORDER', 'SWIGGY FOOD', 'SWIGGY LIMITED'],
    patterns: [
      {
        source: '\\bSWIGGY ?ONE\\b',
        confidence: 0.97,
        reason: 'Swiggy One is a membership, not a food order',
        category: 'subscriptions',
        subcategory: 'Memberships',
      },
      { source: '\\bSWIGGY\\b', confidence: 0.95, reason: 'Merchant text contains "Swiggy"' },
      {
        source: '\\bBUNDL\\b',
        confidence: PROBABLE,
        reason: 'Bundl Technologies is believed to be Swiggy’s legal entity — please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
    note: 'Card statements often show the legal entity "Bundl Technologies" instead of "Swiggy".',
  },

  // ── Quick commerce & groceries ───────────────────────────────────────────────────────────
  {
    slug: 'zepto',
    name: 'Zepto',
    group: 'Quick commerce & groceries',
    kind: 'brand',
    color: '#5B2A9D',
    textColor: '#FFFFFF',
    monogram: 'Z',
    category: 'groceries',
    subcategory: 'Quick commerce',
    website: 'https://www.zeptonow.com',
    emailDomains: ['zeptonow.com'],
    aliases: ['ZEPTO', 'ZEPTO NOW', 'ZEPTONOW'],
    patterns: [
      { source: '\\bZEPTO ?(NOW)?\\b', confidence: 0.96, reason: 'Merchant text contains "Zepto"' },
      {
        source: '\\bKIRANAKART\\b',
        confidence: PROBABLE,
        reason: 'Kiranakart Technologies is believed to be Zepto’s legal entity — please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },
  {
    slug: 'blinkit',
    name: 'Blinkit',
    group: 'Quick commerce & groceries',
    kind: 'brand',
    color: '#F8CB46',
    textColor: '#1B1B1B',
    monogram: 'B',
    category: 'groceries',
    subcategory: 'Quick commerce',
    website: 'https://blinkit.com',
    emailDomains: ['blinkit.com', 'grofers.com'],
    aliases: ['BLINKIT'],
    patterns: [
      { source: '\\bBLINKIT\\b', confidence: 0.96, reason: 'Merchant text contains "Blinkit"' },
      {
        source: '\\bGROFERS\\b',
        confidence: PROBABLE,
        reason: 'Grofers is Blinkit’s former name — please confirm',
      },
      {
        source: '\\bBLINK COMMERCE\\b',
        confidence: PROBABLE,
        reason: 'Blink Commerce is believed to be Blinkit’s legal entity — please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },
  {
    slug: 'swiggy-instamart',
    name: 'Swiggy Instamart',
    group: 'Quick commerce & groceries',
    kind: 'brand',
    color: '#E4572E',
    textColor: '#FFFFFF',
    monogram: 'IM',
    category: 'groceries',
    subcategory: 'Quick commerce',
    website: 'https://www.swiggy.com/instamart',
    emailDomains: ['swiggy.in'],
    aliases: ['INSTAMART', 'SWIGGY INSTAMART', 'SWIGGY IM'],
    patterns: [
      {
        source: '\\bSWIGGY ?(INSTAMART|IM|STORES?)\\b',
        confidence: 0.97,
        reason: 'Merchant text names Swiggy Instamart',
      },
      { source: '\\bINSTAMART\\b', confidence: 0.96, reason: 'Merchant text contains "Instamart"' },
    ],
    verification: 'verified',
    sources: sources(true),
    note: 'A plain "Swiggy" narration cannot be split between food and Instamart — correct it once and Spendly will remember.',
  },
  {
    slug: 'bigbasket',
    name: 'BigBasket',
    group: 'Quick commerce & groceries',
    kind: 'brand',
    color: '#84C225',
    textColor: '#12220A',
    monogram: 'bb',
    brandIcon: 'bigbasket',
    category: 'groceries',
    subcategory: 'Supermarket',
    website: 'https://www.bigbasket.com',
    emailDomains: ['bigbasket.com'],
    aliases: ['BIGBASKET', 'BIG BASKET'],
    patterns: [
      { source: '\\bBIG ?BASKET\\b', confidence: 0.96, reason: 'Merchant text contains "BigBasket"' },
      {
        source: '\\bSUPERMARKET GROCERY SUPPLIES\\b',
        confidence: PROBABLE,
        reason: 'Supermarket Grocery Supplies is believed to be BigBasket’s legal entity — please confirm',
      },
      {
        source: '\\bINNOVATIVE RETAIL CONCEPTS\\b',
        confidence: PROBABLE,
        reason: 'Innovative Retail Concepts is believed to be BigBasket’s former legal entity — please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },
  {
    slug: 'amazon-fresh',
    name: 'Amazon Fresh',
    group: 'Quick commerce & groceries',
    kind: 'brand',
    color: '#2F9E44',
    textColor: '#FFFFFF',
    monogram: 'AF',
    category: 'groceries',
    subcategory: 'Supermarket',
    website: 'https://www.amazon.in/fresh',
    emailDomains: ['amazon.in'],
    aliases: ['AMAZON FRESH'],
    patterns: [
      { source: '\\b(AMAZON|AMZ) ?FRESH\\b', confidence: 0.95, reason: 'Merchant text names Amazon Fresh' },
    ],
    verification: 'verified',
    sources: sources(true),
  },

  // ── Entertainment & events ───────────────────────────────────────────────────────────────
  {
    slug: 'bookmyshow',
    name: 'BookMyShow',
    group: 'Entertainment & events',
    kind: 'brand',
    color: '#D9253E',
    textColor: '#FFFFFF',
    monogram: 'bms',
    brandIcon: 'bookmyshow',
    category: 'entertainment',
    subcategory: 'Movies',
    website: 'https://in.bookmyshow.com',
    emailDomains: ['bookmyshow.com'],
    aliases: ['BOOKMYSHOW', 'BOOK MY SHOW', 'BOOKMYSHOW COM'],
    patterns: [
      { source: '\\bBOOK ?MY ?SHOW\\b', confidence: 0.96, reason: 'Merchant text contains "BookMyShow"' },
      {
        source: '\\bBIG TREE ENTERTAINMENT\\b',
        confidence: PROBABLE,
        reason: 'Big Tree Entertainment is believed to be BookMyShow’s legal entity — please confirm',
      },
      {
        source: '\\bBMS\\b',
        confidence: 0.5,
        reason: '"BMS" is ambiguous — it may or may not be BookMyShow. Please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },
  {
    slug: 'district',
    name: 'District',
    group: 'Entertainment & events',
    kind: 'brand',
    color: '#1C1C1E',
    textColor: '#FFFFFF',
    monogram: 'D',
    category: 'entertainment',
    subcategory: 'Events & concerts',
    website: 'https://www.district.in',
    emailDomains: ['district.in'],
    aliases: ['DISTRICT BY ZOMATO', 'DISTRICT APP'],
    patterns: [
      {
        source: '\\bDISTRICT (BY|FROM) ZOMATO\\b',
        confidence: 0.97,
        reason: 'Merchant text names District by Zomato',
      },
      { source: '\\bDISTRICT (APP|IN)\\b', confidence: 0.8, reason: 'Merchant text names the District app — please confirm' },
      {
        source: '\\bDISTRICT\\b',
        confidence: 0.45,
        reason: '"District" is a common word — please confirm this is the District events app',
      },
    ],
    verification: 'probable',
    sources: sources(true),
    note: 'District (by Zomato) is the current home of movie, dining and event bookings that used to live on Paytm Insider.',
  },
  {
    slug: 'paytm-insider',
    name: 'Paytm Insider',
    group: 'Entertainment & events',
    kind: 'brand',
    color: '#00B9F1',
    textColor: '#04222C',
    monogram: 'PI',
    brandIcon: 'paytm',
    category: 'entertainment',
    subcategory: 'Events & concerts',
    website: 'https://insider.in',
    emailDomains: ['insider.in'],
    aliases: ['PAYTM INSIDER', 'INSIDER IN'],
    patterns: [
      { source: '\\bPAYTM ?INSIDER\\b', confidence: 0.95, reason: 'Merchant text contains "Paytm Insider"' },
      { source: '\\bINSIDER ?IN\\b', confidence: 0.85, reason: 'Merchant text contains "insider.in"' },
    ],
    verification: 'probable',
    sources: sources(true),
    note: 'Legacy listing — newer event bookings usually appear under District.',
  },
  {
    slug: 'movie-theatres',
    name: 'Movie theatres',
    group: 'Entertainment & events',
    kind: 'general',
    icon: 'Popcorn',
    color: '#6D5BD0',
    textColor: '#FFFFFF',
    monogram: 'MT',
    category: 'entertainment',
    subcategory: 'Movies',
    aliases: [],
    patterns: [
      {
        source: '\\b(PVR|INOX|PVR INOX|CINEPOLIS|MIRAJ CINEMAS|CARNIVAL CINEMAS|CINEMAS?|MULTIPLEX)\\b',
        confidence: 0.82,
        reason: 'Merchant text looks like a cinema',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },

  // ── Shopping ─────────────────────────────────────────────────────────────────────────────
  {
    slug: 'amazon',
    name: 'Amazon',
    group: 'Shopping',
    kind: 'brand',
    color: '#FF9900',
    textColor: '#111111',
    monogram: 'a',
    category: 'shopping',
    subcategory: 'Online shopping',
    website: 'https://www.amazon.in',
    emailDomains: ['amazon.in', 'amazon.com'],
    aliases: ['AMAZON', 'AMAZON IN', 'AMAZON SELLER SERVICES', 'AMAZON RETAIL INDIA'],
    patterns: [
      {
        source: '\\bAMAZON ?(IN|SELLER SERVICES|RETAIL)\\b',
        confidence: 0.95,
        reason: 'Merchant text names an Amazon retail entity',
      },
      {
        source: '\\bAMAZON\\b(?! ?(PAY|PRIME|FRESH|WEB SERVICES|AWS))',
        confidence: 0.92,
        reason: 'Merchant text contains "Amazon"',
      },
      { source: '\\bAMZN\\b', confidence: 0.9, reason: 'Merchant text contains "AMZN"' },
      {
        source: '\\bAMAZON ?PAY\\b',
        confidence: 0.6,
        reason: 'Amazon Pay can be a wallet top-up or a payment to another merchant — please confirm',
      },
    ],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'flipkart',
    name: 'Flipkart',
    group: 'Shopping',
    kind: 'brand',
    color: '#2874F0',
    textColor: '#FFFFFF',
    monogram: 'F',
    category: 'shopping',
    subcategory: 'Online shopping',
    website: 'https://www.flipkart.com',
    emailDomains: ['flipkart.com'],
    aliases: ['FLIPKART', 'FLIPKART INTERNET'],
    patterns: [{ source: '\\bFLIPKART\\b', confidence: 0.96, reason: 'Merchant text contains "Flipkart"' }],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'myntra',
    name: 'Myntra',
    group: 'Shopping',
    kind: 'brand',
    color: '#FF3F6C',
    textColor: '#FFFFFF',
    monogram: 'M',
    category: 'shopping',
    subcategory: 'Fashion',
    website: 'https://www.myntra.com',
    emailDomains: ['myntra.com'],
    aliases: ['MYNTRA', 'MYNTRA DESIGNS'],
    patterns: [{ source: '\\bMYNTRA\\b', confidence: 0.96, reason: 'Merchant text contains "Myntra"' }],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'ajio',
    name: 'Ajio',
    group: 'Shopping',
    kind: 'brand',
    color: '#2C4152',
    textColor: '#FFFFFF',
    monogram: 'A',
    category: 'shopping',
    subcategory: 'Fashion',
    website: 'https://www.ajio.com',
    emailDomains: ['ajio.com'],
    aliases: ['AJIO'],
    patterns: [
      { source: '\\bAJIO\\b', confidence: 0.96, reason: 'Merchant text contains "Ajio"' },
      {
        source: '\\bRELIANCE RETAIL\\b',
        confidence: 0.55,
        reason: 'Reliance Retail runs Ajio but also many physical stores — please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },
  {
    slug: 'meesho',
    name: 'Meesho',
    group: 'Shopping',
    kind: 'brand',
    color: '#9F2089',
    textColor: '#FFFFFF',
    monogram: 'M',
    category: 'shopping',
    subcategory: 'Online shopping',
    website: 'https://www.meesho.com',
    emailDomains: ['meesho.com'],
    aliases: ['MEESHO'],
    patterns: [
      { source: '\\bMEESHO\\b', confidence: 0.96, reason: 'Merchant text contains "Meesho"' },
      {
        source: '\\bFASHNEAR\\b',
        confidence: PROBABLE,
        reason: 'Fashnear Technologies is believed to be Meesho’s legal entity — please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },

  // ── Travel & transport ───────────────────────────────────────────────────────────────────
  {
    slug: 'uber',
    name: 'Uber',
    group: 'Travel & transport',
    kind: 'brand',
    color: '#111111',
    textColor: '#FFFFFF',
    monogram: 'U',
    brandIcon: 'uber',
    category: 'transport',
    subcategory: 'Cabs & autos',
    website: 'https://www.uber.com/in',
    emailDomains: ['uber.com'],
    aliases: ['UBER', 'UBER INDIA SYSTEMS', 'UBER INDIA'],
    patterns: [
      {
        source: '\\bUBER\\b(?! ?EATS)',
        confidence: 0.95,
        reason: 'Merchant text contains "Uber"',
      },
    ],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'ola',
    name: 'Ola',
    group: 'Travel & transport',
    kind: 'brand',
    color: '#BEE000',
    textColor: '#111111',
    monogram: 'O',
    category: 'transport',
    subcategory: 'Cabs & autos',
    website: 'https://www.olacabs.com',
    emailDomains: ['olacabs.com'],
    aliases: ['OLA', 'OLA CABS', 'OLACABS'],
    patterns: [
      { source: '\\bOLA ?CABS\\b', confidence: 0.95, reason: 'Merchant text contains "Ola Cabs"' },
      {
        source: '\\bANI TECHNOLOGIES\\b',
        confidence: PROBABLE,
        reason: 'ANI Technologies is believed to be Ola’s legal entity — please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },
  {
    slug: 'rapido',
    name: 'Rapido',
    group: 'Travel & transport',
    kind: 'brand',
    color: '#FFD100',
    textColor: '#111111',
    monogram: 'R',
    category: 'transport',
    subcategory: 'Cabs & autos',
    website: 'https://www.rapido.bike',
    emailDomains: ['rapido.bike'],
    aliases: ['RAPIDO'],
    patterns: [
      { source: '\\bRAPIDO\\b', confidence: 0.96, reason: 'Merchant text contains "Rapido"' },
      {
        source: '\\bROPPEN\\b',
        confidence: PROBABLE,
        reason: 'Roppen Transportation is believed to be Rapido’s legal entity — please confirm',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },
  {
    slug: 'irctc',
    name: 'IRCTC',
    group: 'Travel & transport',
    kind: 'brand',
    color: '#1E4D9B',
    textColor: '#FFFFFF',
    monogram: 'IR',
    category: 'transport',
    subcategory: 'Trains',
    website: 'https://www.irctc.co.in',
    emailDomains: ['irctc.co.in'],
    aliases: ['IRCTC', 'IRCTC WEB'],
    patterns: [
      { source: '\\bIRCTC\\b', confidence: 0.96, reason: 'Merchant text contains "IRCTC"' },
      {
        source: '\\bINDIAN RAILWAY CATERING\\b',
        confidence: 0.92,
        reason: 'Merchant text names Indian Railway Catering and Tourism Corporation',
      },
    ],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'flights-hotels',
    name: 'Flights & hotels',
    group: 'Travel & transport',
    kind: 'general',
    icon: 'Plane',
    color: '#0EA5E9',
    textColor: '#FFFFFF',
    monogram: 'FH',
    category: 'transport',
    aliases: [],
    patterns: [
      {
        source: '\\b(INTERGLOBE AVIATION|AIR INDIA|AKASA AIR|SPICEJET|VISTARA)\\b',
        confidence: 0.9,
        reason: 'Merchant text names an airline',
        subcategory: 'Flights',
      },
      {
        source: '\\b(MAKE ?MY ?TRIP|GOIBIBO|CLEARTRIP|EASE ?MY ?TRIP|YATRA)\\b',
        confidence: 0.9,
        reason: 'Merchant text names a travel booking site',
        subcategory: 'Flights',
      },
      {
        source: '\\b(OYO|OYO ROOMS|AIRBNB|BOOKING COM|AGODA|TAJ HOTELS|ITC HOTELS|MARRIOTT|HYATT)\\b',
        confidence: 0.88,
        reason: 'Merchant text names a hotel or stay',
        subcategory: 'Hotels & stays',
      },
      {
        source: '\\bINDIGO\\b',
        confidence: 0.75,
        reason: '"IndiGo" is usually the airline — please confirm',
        subcategory: 'Flights',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },

  // ── Subscriptions & digital ──────────────────────────────────────────────────────────────
  {
    slug: 'netflix',
    name: 'Netflix',
    group: 'Subscriptions & digital',
    kind: 'brand',
    color: '#E50914',
    textColor: '#FFFFFF',
    monogram: 'N',
    brandIcon: 'netflix',
    category: 'subscriptions',
    subcategory: 'Streaming',
    website: 'https://www.netflix.com',
    emailDomains: ['netflix.com'],
    aliases: ['NETFLIX', 'NETFLIX COM', 'NETFLIX ENTERTAINMENT SERVICES INDIA'],
    patterns: [{ source: '\\bNETFLIX\\b', confidence: 0.97, reason: 'Merchant text contains "Netflix"' }],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'spotify',
    name: 'Spotify',
    group: 'Subscriptions & digital',
    kind: 'brand',
    color: '#1DB954',
    textColor: '#0B0B0B',
    monogram: 'S',
    brandIcon: 'spotify',
    category: 'subscriptions',
    subcategory: 'Music',
    website: 'https://www.spotify.com',
    emailDomains: ['spotify.com'],
    aliases: ['SPOTIFY', 'SPOTIFY INDIA'],
    patterns: [{ source: '\\bSPOTIFY\\b', confidence: 0.97, reason: 'Merchant text contains "Spotify"' }],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'youtube-premium',
    name: 'YouTube Premium',
    group: 'Subscriptions & digital',
    kind: 'brand',
    color: '#FF0000',
    textColor: '#FFFFFF',
    monogram: 'YT',
    brandIcon: 'youtube',
    category: 'subscriptions',
    subcategory: 'Streaming',
    website: 'https://www.youtube.com/premium',
    emailDomains: ['youtube.com'],
    aliases: ['YOUTUBE PREMIUM', 'YOUTUBE MUSIC', 'GOOGLE YOUTUBE'],
    patterns: [
      { source: '\\bYOUTUBE ?(PREMIUM|MUSIC)\\b', confidence: 0.96, reason: 'Merchant text names YouTube Premium/Music' },
      { source: '\\bYOUTUBE\\b', confidence: 0.82, reason: 'Merchant text contains "YouTube"' },
    ],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'prime-video',
    name: 'Prime Video / Amazon Prime',
    group: 'Subscriptions & digital',
    kind: 'brand',
    color: '#00A8E1',
    textColor: '#06222D',
    monogram: 'P',
    category: 'subscriptions',
    subcategory: 'Streaming',
    website: 'https://www.primevideo.com',
    emailDomains: ['primevideo.com'],
    aliases: ['AMAZON PRIME', 'PRIME VIDEO', 'AMAZON PRIME VIDEO'],
    patterns: [
      {
        source: '\\b(AMAZON ?PRIME|AMZ ?PRIME|PRIME ?VIDEO)\\b',
        confidence: 0.96,
        reason: 'Merchant text names Amazon Prime / Prime Video',
      },
    ],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'google-services',
    name: 'Google services',
    group: 'Subscriptions & digital',
    kind: 'brand',
    color: '#4285F4',
    textColor: '#FFFFFF',
    monogram: 'G',
    brandIcon: 'google',
    category: 'subscriptions',
    subcategory: 'Cloud & software',
    website: 'https://one.google.com',
    emailDomains: ['google.com'],
    aliases: ['GOOGLE ONE', 'GOOGLE STORAGE', 'GOOGLE PLAY', 'GOOGLE CLOUD', 'GOOGLE WORKSPACE'],
    patterns: [
      {
        source: '\\bGOOGLE ?(ONE|STORAGE|PLAY|WORKSPACE|CLOUD|DOMAINS)\\b',
        confidence: 0.93,
        reason: 'Merchant text names a Google paid service',
      },
      {
        source: '\\bGOOGLE\\b(?! ?PAY)',
        confidence: 0.65,
        reason: '"Google" alone is ambiguous — please confirm which service this is',
      },
    ],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'apple-services',
    name: 'Apple services',
    group: 'Subscriptions & digital',
    kind: 'brand',
    color: '#D1D5DB',
    textColor: '#111111',
    monogram: 'A',
    brandIcon: 'apple',
    category: 'subscriptions',
    subcategory: 'Cloud & software',
    website: 'https://www.apple.com/in/services',
    emailDomains: ['apple.com'],
    aliases: ['APPLE COM BILL', 'ITUNES', 'ICLOUD', 'APPLE SERVICES'],
    patterns: [
      {
        source: '\\b(APPLE COM BILL|APPLE ?(MUSIC|ICLOUD|ONE|TV|SERVICES)|ITUNES|APP ?STORE|ICLOUD)\\b',
        confidence: 0.94,
        reason: 'Merchant text names an Apple service',
      },
      {
        source: '\\bAPPLE\\b',
        confidence: 0.65,
        reason: '"Apple" alone may be a device purchase or a service — please confirm',
      },
    ],
    verification: 'verified',
    sources: sources(true),
  },
  {
    slug: 'gaming',
    name: 'Gaming subscriptions',
    group: 'Subscriptions & digital',
    kind: 'brand',
    color: '#107C10',
    textColor: '#FFFFFF',
    monogram: 'GM',
    brandIcon: 'playstation',
    category: 'subscriptions',
    subcategory: 'Gaming',
    aliases: [],
    patterns: [
      {
        source: '\\b(PLAYSTATION|SONY INTERACTIVE|XBOX|NINTENDO|EA ?PLAY|GAME ?PASS|EPIC GAMES|STEAM ?(GAMES|PURCHASE)?)\\b',
        confidence: 0.9,
        reason: 'Merchant text names a gaming service',
      },
    ],
    verification: 'verified',
    sources: sources(false),
  },
  {
    slug: 'jiohotstar',
    name: 'JioHotstar',
    group: 'Subscriptions & digital',
    kind: 'brand',
    color: '#1F2A6B',
    textColor: '#FFFFFF',
    monogram: 'JH',
    category: 'subscriptions',
    subcategory: 'Streaming',
    website: 'https://www.hotstar.com',
    emailDomains: ['hotstar.com', 'jiohotstar.com'],
    aliases: ['HOTSTAR', 'DISNEY HOTSTAR', 'JIOHOTSTAR'],
    patterns: [
      {
        source: '\\b(JIO ?HOTSTAR|DISNEY ?HOTSTAR|HOTSTAR|JIOSTAR)\\b',
        confidence: 0.95,
        reason: 'Merchant text names Hotstar / JioHotstar',
      },
    ],
    verification: 'probable',
    sources: sources(true),
  },

  // ── Other: general buckets ───────────────────────────────────────────────────────────────
  {
    slug: 'restaurants',
    name: 'Restaurants',
    group: 'Other',
    kind: 'general',
    icon: 'Utensils',
    color: '#F59E0B',
    textColor: '#1F1300',
    monogram: 'R',
    category: 'dining-out',
    subcategory: 'Restaurants',
    aliases: [],
    patterns: [
      {
        source:
          '\\b(RESTAURANT|RESTO|DHABA|BIRYANI|EATERY|BISTRO|FOOD COURT|DINER|GRILL|TANDOOR|PIZZA|DOMINOS|DOMINO S|MCDONALD S?|MCDONALDS|KFC|BURGER KING|SUBWAY|HALDIRAM S?|WOW MOMO|BEHROUZ|FAASOS|BARBEQUE NATION|KITCHEN)\\b',
        confidence: 0.78,
        reason: 'Merchant text looks like a restaurant',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },
  {
    slug: 'cafes',
    name: 'Cafes',
    group: 'Other',
    kind: 'general',
    icon: 'Coffee',
    color: '#A16207',
    textColor: '#FFFFFF',
    monogram: 'C',
    category: 'dining-out',
    subcategory: 'Cafes',
    aliases: [],
    patterns: [
      {
        source:
          '\\b(CAFE|COFFEE|STARBUCKS|CHAI|CAFE COFFEE DAY|CCD|BARISTA|THIRD WAVE|BLUE TOKAI|CHAAYOS|CHAI POINT|BAKERY)\\b',
        confidence: 0.78,
        reason: 'Merchant text looks like a cafe',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },
  {
    slug: 'malls',
    name: 'Shopping malls',
    group: 'Other',
    kind: 'general',
    icon: 'Store',
    color: '#DB2777',
    textColor: '#FFFFFF',
    monogram: 'M',
    category: 'shopping',
    subcategory: 'Malls & stores',
    aliases: [],
    patterns: [
      {
        source: '\\b(MALL|PHOENIX MARKETCITY|PHOENIX PALLADIUM|INORBIT|NEXUS|SELECT CITYWALK|LULU|FORUM MALL|DLF PROMENADE)\\b',
        confidence: 0.68,
        reason: 'Merchant text looks like a shopping mall — please confirm',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },
  {
    slug: 'utilities',
    name: 'Utility bills',
    group: 'Other',
    kind: 'general',
    icon: 'Zap',
    color: '#EAB308',
    textColor: '#1F1A00',
    monogram: 'U',
    category: 'bills',
    subcategory: 'Electricity',
    aliases: [],
    patterns: [
      {
        source:
          '\\b(ELECTRICITY|BESCOM|MSEDCL|TATA POWER|ADANI ELECTRICITY|BSES|TNEB|TANGEDCO|KSEB|WATER BILL|GAS BILL|INDANE|HP GAS|BHARATGAS|PIPED GAS|MAHANAGAR GAS|INDRAPRASTHA GAS)\\b',
        confidence: 0.88,
        reason: 'Merchant text looks like an electricity/water/gas bill',
        subcategory: 'Electricity',
      },
      {
        source:
          '\\b(BROADBAND|ACT FIBERNET|AIRTEL|JIO|VODAFONE|VI PREPAID|BSNL|TATA PLAY|DISH TV|D2H|RECHARGE)\\b',
        confidence: 0.8,
        reason: 'Merchant text looks like a mobile, internet or DTH bill',
        subcategory: 'Internet & mobile',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },
  {
    slug: 'rent',
    name: 'Rent',
    group: 'Other',
    kind: 'general',
    icon: 'House',
    color: '#B91C1C',
    textColor: '#FFFFFF',
    monogram: 'R',
    category: 'rent',
    subcategory: 'Rent',
    aliases: [],
    patterns: [
      {
        source: '\\b(HOUSE RENT|FLAT RENT|PG RENT|ROOM RENT|RENT PAYMENT|RENT FOR|LANDLORD|NOBROKER RENT|NO BROKER RENT|RENT)\\b',
        confidence: 0.78,
        reason: 'Merchant text mentions rent',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },
  {
    slug: 'fuel',
    name: 'Fuel',
    group: 'Other',
    kind: 'general',
    icon: 'Fuel',
    color: '#0F766E',
    textColor: '#FFFFFF',
    monogram: 'F',
    category: 'fuel',
    subcategory: 'Petrol',
    aliases: [],
    patterns: [
      {
        source:
          '\\b(HPCL|BPCL|IOCL|INDIAN OIL|INDIANOIL|HINDUSTAN PETROLEUM|BHARAT PETROLEUM|SHELL|NAYARA|RELIANCE PETRO|JIO BP|PETROL|DIESEL|FUEL|PETROL PUMP|FILLING STATION)\\b',
        confidence: 0.88,
        reason: 'Merchant text looks like a fuel station',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },
  {
    slug: 'medical',
    name: 'Medical expenses',
    group: 'Other',
    kind: 'general',
    icon: 'Stethoscope',
    color: '#E11D48',
    textColor: '#FFFFFF',
    monogram: 'M',
    category: 'health',
    subcategory: 'Pharmacy',
    aliases: [],
    patterns: [
      {
        source:
          '\\b(PHARMACY|PHARMEASY|APOLLO|MEDPLUS|1MG|TATA 1MG|NETMEDS|HOSPITAL|CLINIC|DIAGNOSTICS?|PATH LABS?|PRACTO|CHEMIST|DENTAL|MEDICAL|MEDICINES?)\\b',
        confidence: 0.84,
        reason: 'Merchant text looks like a medical provider or pharmacy',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },
  {
    slug: 'education',
    name: 'Education',
    group: 'Other',
    kind: 'general',
    icon: 'GraduationCap',
    color: '#6D28D9',
    textColor: '#FFFFFF',
    monogram: 'E',
    category: 'education',
    subcategory: 'Tuition & fees',
    aliases: [],
    patterns: [
      {
        source:
          '\\b(SCHOOL|COLLEGE|UNIVERSITY|TUITION|COURSERA|UDEMY|UNACADEMY|BYJU S?|VEDANTU|COACHING|ACADEMY|EXAM FEE|EDTECH|UPGRAD)\\b',
        confidence: 0.8,
        reason: 'Merchant text looks like an education provider',
      },
    ],
    verification: 'verified',
    sources: sources(false, GENERAL_NOTE),
  },
];

export const PLATFORM_BY_SLUG: ReadonlyMap<string, PlatformDef> = new Map(PLATFORMS.map((p) => [p.slug, p]));

export function platformName(slug: string | null | undefined): string {
  if (!slug) return 'Other / unassigned';
  return PLATFORM_BY_SLUG.get(slug)?.name ?? slug.replace(/^custom-/, '').replace(/-/g, ' ');
}

export function platformsInGroup(group: PlatformGroup): PlatformDef[] {
  return PLATFORMS.filter((p) => p.group === group);
}

/** Label used for spending that has no recognised platform ("general UPI, card, bank and cash"). */
export const UNASSIGNED_PLATFORM_LABEL = 'Other / unassigned';
