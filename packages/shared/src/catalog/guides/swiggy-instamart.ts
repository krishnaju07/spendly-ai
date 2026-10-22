import type { AppGuide } from '../app-guide';

export const GUIDE_SWIGGY_INSTAMART: AppGuide = {
  slug: 'swiggy-instamart',
  status: 'Read through your Swiggy link (last 15 days)',
  ways: [
    {
      title: 'Link your Swiggy account',
      accepts: 'Nothing to upload',
      importKind: 'auto',
      steps: [
        'Tick "Swiggy Instamart" in your tracked apps.',
        'Open Settings, then Tracked apps.',
        'Click "Link Swiggy".',
        "Enter your phone number and OTP on Swiggy's own page, in the small window.",
        'Click "Sync now".',
      ],
    },
    {
      title: 'Upload an Instamart invoice or receipt email',
      accepts: 'PDF invoice or receipt email (.eml)',
      importKind: 'receipt',
      steps: [
        'Open your Instamart order in the Swiggy app, or find its email from swiggy.in.',
        'Download the order invoice as a PDF, or save the email as an .eml file.',
        'Open Import in Spendly.',
        'Upload the file.',
      ],
    },
  ],
  unverified: [
    'We have not checked what Instamart orders look like on a live Swiggy account, so some may read oddly or be missed.',
    'Swiggy shares only the last 15 days of orders, so older orders need the invoice route.',
    'The invoice steps are general, because we have not confirmed where the invoice option sits in the app.',
    'Your screens may look different from what these steps describe.',
  ],
};
