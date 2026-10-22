import type { AppGuide } from '../app-guide';

export const GUIDE_PRIME_VIDEO: AppGuide = {
  slug: 'prime-video',
  status: 'Prime Video offers no sign-in for apps like Spendly. Amazon shares no payment data.',
  ways: [
    {
      title: 'Download your Prime membership invoice',
      accepts: 'Prime membership invoice from your Amazon account',
      importKind: 'receipt',
      steps: [
        'Sign in to your account on amazon.in.',
        'Open the payments or orders area of your account.',
        'Find your Prime membership payment.',
        'Download the invoice for that payment.',
        'Upload the invoice in Import.',
      ],
    },
    {
      title: 'Save the Prime receipt email',
      accepts: '.eml email',
      importKind: 'receipt',
      steps: [
        'Open the Prime receipt email in your mail app.',
        'Save or download that email as an .eml file.',
        'Open Import in Spendly.',
        'Upload the .eml file.',
      ],
    },
    {
      title: 'Request your Amazon data',
      accepts: 'Order-history CSV (Prime fees may not be in it)',
      importKind: 'generic',
      steps: [
        'Open the "Request My Data" page on amazon.in.',
        'Ask for your order history.',
        'Wait for Amazon to tell you the files are ready. This can take 1 to 30 days.',
        'Download the files and find the order-history CSV.',
        'Upload the CSV in Import. Check that your Prime payment is in it, as it may not be.',
      ],
    },
  ],
  unverified: [
    'We could not confirm that Prime fee charges appear in the Request My Data files, and one source says they list only payment-method details.',
    'The reported wait for a data request is 1 to 3 days, and up to 30, but this comes from third-party guides and not from Amazon.',
    'Prime invoices are said to come from Amazon Seller Services Pvt Ltd with GST and a transaction ID, but we only saw unofficial samples.',
    'We could not confirm the sender address or subject line of Prime receipt emails, or whether the amount, date and plan are in the email body.',
    'Prime that comes with Airtel postpaid (a 6-month reward claimed in the app), Jio or Vi will likely show as a phone bill charge with no Amazon receipt, but we could not confirm this.',
    'Spendly lists primevideo.com for this app, but real receipts may come from amazon.in.',
  ],
};
