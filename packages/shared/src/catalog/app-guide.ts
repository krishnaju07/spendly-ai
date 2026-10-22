/**
 * How a person brings one app's real spending into Spendly when the app offers no sign-in for it. Written from what
 * each app's own pages, help centre and policies say; whatever could not be confirmed is listed in `unverified`, plainly.
 * Every route here is one the person does themselves (downloading their own receipt or export) and then uploads to Import.
 */
export interface AppGuideWay {
  /** A short name for the route, e.g. "Download the invoice PDF". */
  title: string;
  /** What gets uploaded to Import, e.g. "PDF invoice" or ".eml email". */
  accepts: string;
  /** Which Import file type fits, so the upload can be preselected. */
  importKind: 'auto' | 'receipt' | 'generic';
  /** Two to five short steps, plain English, each one action. */
  steps: string[];
}

export interface AppGuide {
  /** The tracked app's slug, as in `TRACK_SECTIONS`. */
  slug: string;
  /** One line for the app's row: what the app offers (no sign-in for apps like Spendly, and why, in a few words). */
  status: string;
  /** The best routes first. */
  ways: AppGuideWay[];
  /** Things that could not be confirmed (formats, senders, turnaround), each a plain sentence. Empty only if nothing is in doubt. */
  unverified: string[];
}
