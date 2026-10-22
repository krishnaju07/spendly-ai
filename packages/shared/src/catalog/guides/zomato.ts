import type { AppGuide } from '../app-guide';

export const GUIDE_ZOMATO: AppGuide = {
  slug: 'zomato',
  status: 'Linkable once Zomato approves your return address (personal use); receipts work now',
  ways: [
    {
      title: 'Link Zomato (needs Zomato’s approval first)',
      accepts: 'Nothing to upload',
      importKind: 'auto',
      steps: [
        'Open the access form in Zomato’s public MCP page on GitHub (github.com/Zomato/mcp-server-manifest, the link under “request access”).',
        'Say it is for personal use: your own Spendly on your own computer, to read your own order history.',
        'Ask Zomato to allow the return address shown under “Link your accounts” (use the Copy button).',
        'When Zomato approves, tick Zomato in your tracked apps and click “Link Zomato”.',
        'Sign in on Zomato’s page in the small window, then click “Sync now” and check what it found.',
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
    'Zomato’s README says access is reviewed by Zomato and for personal use only, and that it currently allows only a short list of return addresses. How long a review takes is not stated.',
    'Zomato’s order-history tool is named in its public tool catalogue, but what it returns has not been seen on a real account, so the first sync asks you to confirm what it found.',
    'Zomato’s order emails and invoices were not checked: we do not know their sender, subject or layout.',
    'Zomato’s privacy policy gives no download right and no turnaround time, and the new data-access right in India’s DPDP law cannot be enforced until about May 2027.',
  ],
};
