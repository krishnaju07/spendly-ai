/**
 * The apps Spendly can be asked to keep track of. Deliberately narrow: food and grocery delivery, and
 * entertainment (events, streaming, music). Nothing on the bank side is offered here.
 *
 * "Tracking" is a promise about what Spendly looks for in the statements, receipts and entries the
 * person adds. Spendly never logs in to these apps and never holds their passwords.
 */

export interface TrackSection {
  id: 'food' | 'entertainment';
  title: string;
  hint: string;
  slugs: readonly string[];
}

export const TRACK_SECTIONS: readonly TrackSection[] = [
  { id: 'food', title: 'Food & groceries', hint: 'Delivery and quick commerce', slugs: ['zomato', 'swiggy', 'zepto', 'blinkit', 'swiggy-instamart', 'bigbasket'] },
  { id: 'entertainment', title: 'Entertainment', hint: 'Events, streaming and music', slugs: ['bookmyshow', 'district', 'paytm-insider', 'netflix', 'spotify', 'youtube-premium', 'prime-video', 'jiohotstar'] },
];

/** Every slug that can be tracked, in the order the list shows them. */
export const TRACKABLE_SLUGS: readonly string[] = TRACK_SECTIONS.flatMap((s) => s.slugs);

export const MAX_TRACKED = TRACKABLE_SLUGS.length;

export const isTrackable = (slug: string): boolean => TRACKABLE_SLUGS.includes(slug);
