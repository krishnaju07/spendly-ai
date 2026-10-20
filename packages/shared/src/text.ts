const DIACRITICS = /[̀-ͯ]/g;

/**
 * Canonical form used for all merchant matching: upper-case ASCII letters and digits separated by
 * single spaces. "Zomato Ltd." -> "ZOMATO LTD", "H&M" -> "H AND M", "zomato@hdfcbank" -> "ZOMATO HDFCBANK".
 */
export function normalizeText(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized;
}

const CORPORATE_SUFFIXES = new Set([
  'PVT',
  'PRIVATE',
  'LTD',
  'LIMITED',
  'LLP',
  'INC',
  'CORP',
  'CORPORATION',
  'CO',
  'OPC',
]);

/** Removes "PVT LTD"-style suffixes from an already-normalised string. */
export function stripCorporateSuffixes(normalized: string): string {
  const kept = normalized.split(' ').filter((t) => !CORPORATE_SUFFIXES.has(t));
  return kept.length > 0 ? kept.join(' ') : normalized;
}

const INDIAN_CITIES = [
  'NEW DELHI',
  'NAVI MUMBAI',
  'MUMBAI',
  'DELHI',
  'GURGAON',
  'GURUGRAM',
  'NOIDA',
  'GREATER NOIDA',
  'BANGALORE',
  'BENGALURU',
  'HYDERABAD',
  'CHENNAI',
  'KOLKATA',
  'PUNE',
  'AHMEDABAD',
  'JAIPUR',
  'SURAT',
  'LUCKNOW',
  'KOCHI',
  'COCHIN',
  'CHANDIGARH',
  'INDORE',
  'BHOPAL',
  'NAGPUR',
  'THANE',
  'FARIDABAD',
  'GHAZIABAD',
  'MYSURU',
  'MYSORE',
  'VISAKHAPATNAM',
  'COIMBATORE',
  'VADODARA',
  'TRIVANDRUM',
  'THIRUVANANTHAPURAM',
  'PATNA',
  'GOA',
  'PANAJI',
];
const TRAILING_LOCATION = new RegExp(
  `\\s(?:${INDIAN_CITIES.join('|')})(?:\\s(?:IN|IND|INDIA))?$|\\s(?:IN|IND)$`,
);

/** Drops a trailing city / country code left behind by card statements ("BIRYANI BLUES BANGALORE IN"). */
export function stripTrailingLocation(normalized: string): string {
  let current = normalized;
  for (let i = 0; i < 2; i++) {
    const next = current.replace(TRAILING_LOCATION, '');
    if (next === current || next.length === 0) break;
    current = next;
  }
  return current;
}

const KEEP_UPPER = new Set([
  'KFC',
  'IRCTC',
  'HDFC',
  'ICICI',
  'SBI',
  'ATM',
  'UPI',
  'PVR',
  'INOX',
  'BPCL',
  'HPCL',
  'IOCL',
  'OYO',
  'BMS',
  'LIC',
  'EMI',
  'GST',
  'DMART',
  'IKEA',
  'H',
  'M',
  'AND',
]);

/** "BIRYANI BLUES" -> "Biryani Blues", keeping well-known acronyms upper-case. */
export function displayName(normalized: string): string {
  return normalized
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word === 'AND') return '&';
      if (KEEP_UPPER.has(word)) return word;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(' ')
    .replace(/\bH & M\b/, 'H&M');
}

export function slugify(input: string): string {
  return normalizeText(input).toLowerCase().replace(/ /g, '-');
}

export function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function tokenize(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

/** Jaro–Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j] || a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Share of tokens two normalised strings have in common (Jaccard). */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Merchant similarity in [0, 1] on already-normalised strings. */
export function merchantSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  return Math.max(jaroWinkler(a, b), tokenOverlap(a, b));
}
