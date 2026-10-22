import type { AppGuide } from '../app-guide';

export const GUIDE_BIGBASKET: AppGuide = {
  slug: 'bigbasket',
  status: 'BigBasket offers no sign-in for apps like Spendly. Use your invoices instead.',
  ways: [
    {
      title: 'Download the tax invoice PDF',
      accepts: 'PDF tax invoice',
      importKind: 'receipt',
      steps: [
        'Open the BigBasket app or website and sign in.',
        'Go to My Orders.',
        'Open a delivered order.',
        'Download the tax invoice PDF.',
        'Upload the PDF in Import in Spendly.',
      ],
    },
    {
      title: 'Save an invoice email',
      accepts: '.eml email',
      importKind: 'receipt',
      steps: [
        'Look in your inbox for an invoice email from customerservice@bigbasket.com.',
        'Open the email.',
        'Save it as a .eml file.',
        'Upload the .eml file in Import in Spendly.',
      ],
    },
    {
      title: 'Ask BigBasket for a copy of your data (optional)',
      accepts: 'Whatever file BigBasket sends (the format is not known)',
      importKind: 'auto',
      steps: [
        'Email customerservice@bigbasket.com and ask for a copy of your data.',
        'Wait for the reply. The privacy policy says within 30 days.',
        'Save the file they send you.',
        'Upload it in Import in Spendly.',
      ],
    },
  ],
  unverified: [
    'The invoice steps come from one third-party blog, so the buttons in the current app may be different.',
    'We could not confirm how far back your orders and invoices go.',
    'We could not confirm that BigBasket emails invoices, and an old copy suggests a subject like "Invoice #… for Order #…" that may have changed.',
    'The privacy policy says you can ask for a copy of your data, but it does not say what format you will get back.',
    'The new data access right under India\'s DPDP law cannot be enforced until about 13 May 2027, so a request today depends on BigBasket\'s own policy.',
  ],
};
