import type { AppGuide } from '../app-guide';

export const GUIDE_SPOTIFY: AppGuide = {
  slug: 'spotify',
  status: 'Spotify offers no sign-in for apps like Spendly, so you upload your own receipts.',
  ways: [
    {
      title: 'Download your receipts from your Spotify account',
      accepts: 'Receipt file downloaded from your Spotify account page',
      importKind: 'receipt',
      steps: [
        'Sign in to your Spotify account on the web.',
        'Open your account page.',
        'Open Receipts. Spotify keeps the last 2 years.',
        'Download each receipt you want to track.',
        'In Spendly, open Import and upload the receipt files.',
      ],
    },
    {
      title: 'Use your Google Play receipt',
      accepts: 'Receipt from your Google Play order history',
      importKind: 'receipt',
      steps: [
        'Check whether Google Play bills your Spotify Premium.',
        'If it does, open your order history in Google Play.',
        'Find the Spotify charge and open its receipt.',
        'Save the receipt as a file, if Google lets you.',
        'In Spendly, open Import and upload the receipt file.',
      ],
    },
    {
      title: 'Request your data export',
      accepts: 'Payment file from the data export ZIP (JSON, contents unconfirmed)',
      importKind: 'generic',
      steps: [
        'Find Download your data in your Spotify account privacy settings.',
        'Request your account data.',
        'Wait for Spotify to tell you the export is ready.',
        'Download the ZIP file and unzip it.',
        'In Spendly, open Import and upload any payment file from inside it.',
      ],
    },
  ],
  unverified: [
    'Spotify does not say what file type a downloaded receipt is.',
    "Spotify's own page says Payments in the data export holds card details only, but a September 2026 third-party guide calls Payments.json a billing history, and we have not opened a real file.",
    'Third-party guides say account data takes a few days and extended history takes up to 30 days.',
    'Spotify emails you when a trial starts and after the first payment, and a moderator says there are no monthly receipt emails.',
    'Sender addresses and subject lines are not verified, and phishers spoof no-reply@spotify.com, so do not trust it.',
    'We could not confirm how telco bundles are billed, and Google Play receipts live with Google, not Spotify.',
  ],
};
