/**
 * Accounts Spendly can be linked to so real orders arrive without a file. Each one is the service's own
 * sign-in (its phone-and-OTP page), never a password or code typed into Spendly.
 */

export const PROVIDER_IDS = ['swiggy', 'zepto', 'zomato'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const isProviderId = (value: string): value is ProviderId => (PROVIDER_IDS as readonly string[]).includes(value);

export interface ProviderConnectionDto {
  id: ProviderId;
  name: string;
  /** `available`: can be linked now. `blocked`: the service has not opened its sign-in to apps like Spendly yet. */
  access: 'available' | 'blocked';
  /** Plain-language status for the person: what linking does, or why it cannot be done yet. */
  note: string;
  /** Not yet seen working on a real account: the first sync shows what it found and waits for the person to confirm before saving. */
  review: boolean;
  /** What the service shares, and for how far back. */
  limits: string;
  /** Where the service sends the person back to after signing in: the address a service has to allow before it will sign Spendly in. */
  returnAddress: string;
  /** Tracked-app slugs this link reads; the ones not ticked in the track list are skipped. */
  platforms: string[];
  connected: boolean;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncAdded: number | null;
  /** Set when the last sync or token refresh failed; `reconnect` means the sign-in has to be repeated. */
  lastError: string | null;
}

/** One order a sync found, for the person to check before it is saved. */
export interface ProviderPreviewOrder {
  merchantName: string;
  description: string;
  date: string;
  amountPaise: number;
  status: 'completed' | 'pending' | 'cancelled';
}

export interface ProviderSyncResultDto {
  /** Set when the sync only looked (nothing was saved): the orders it would add. */
  preview?: ProviderPreviewOrder[];
  added: number;
  updated: number;
  skipped: number;
  /** Orders the service returned. */
  scanned: number;
  notes: string[];
}
