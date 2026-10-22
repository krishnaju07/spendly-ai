import type { AppGuide } from '../app-guide';

export const GUIDE_ZOMATO: AppGuide = {
  slug: 'zomato',
  status: 'Link it with a sign-in on Zomato’s page; receipts work too',
  ways: [
    {
      title: 'Link Zomato',
      accepts: 'Nothing to upload',
      importKind: 'auto',
      steps: [
        'Tick Zomato in your tracked apps, then click “Link Zomato” under “Link your accounts”.',
        'Sign in on Zomato’s own page in the small window.',
        'Click “Sync now” and check the orders Zomato sent before you add them.',
        'If Zomato refuses the sign-in, ask it to allow your return address (shown under “Link your accounts”, with a Copy button): use the access form linked from Zomato’s public MCP page on GitHub (github.com/Zomato/mcp-server-manifest), and say it is for personal use, on your own computer.',
      ],
    },
    {
      title: 'Save the order receipt email',
      accepts: '.eml email',
      importKind: 'receipt',
      steps: [
        'Open the Zomato order receipt or invoice email in your email app.',
        'Save or download the email as an .eml file.',
        'Open Import in Spendly.',
        'Upload the .eml file.',
      ],
    },
    {
      title: 'Save the invoice from the Zomato app',
      accepts: 'PDF invoice or screenshot',
      importKind: 'receipt',
      steps: [
        'Open your order in the Zomato app.',
        'Save the order’s invoice, or take a screenshot of it.',
        'Open Import in Spendly.',
        'Upload the file.',
      ],
    },
  ],
  unverified: [
    'Zomato’s README says access is for personal use only and that it allows only approved return addresses. Spendly on a computer at localhost signed in on a real account; a Spendly on a public address may need Zomato’s approval, and how long a review takes is not stated.',
    'Zomato prints no year on its order dates, so Spendly works the year out from the order of the list: check the dates on older orders.',
    'Zomato’s order emails and invoices were not checked: we do not know their sender, subject or layout.',
    'Zomato’s privacy policy gives no download right and no turnaround time, and the new data-access right in India’s DPDP law cannot be enforced until about May 2027.',
  ],
};
