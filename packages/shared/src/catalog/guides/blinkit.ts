import type { AppGuide } from '../app-guide';

export const GUIDE_BLINKIT: AppGuide = {
  slug: 'blinkit',
  status: 'Blinkit offers no sign-in for apps like Spendly, and has no public API for your orders.',
  ways: [
    {
      title: 'Download the invoice PDF',
      accepts: 'PDF invoice',
      importKind: 'receipt',
      steps: [
        'Open the Blinkit app or website and sign in.',
        'Open the order you want to add.',
        'Download the invoice for that order as a PDF.',
        'Repeat for each order you want to add.',
        'In Spendly, open Import and upload the PDF.',
      ],
    },
    {
      title: 'Save a Blinkit email receipt',
      accepts: '.eml email',
      importKind: 'receipt',
      steps: [
        'Look in your email inbox for a Blinkit order receipt.',
        'Open the email and save it as an .eml file.',
        'In Spendly, open Import.',
        'Upload the .eml file.',
      ],
    },
  ],
  unverified: [
    'The exact steps to download an invoice in the current Blinkit app and website are not confirmed, so the buttons may look different.',
    'We could not confirm that Blinkit sends order receipts by email.',
    'If it does, we do not know the sender address, the subject line or what the email contains.',
    'Invoice PDFs are a low-quality source, so check what Spendly reads from them.',
    'Blinkit\'s privacy policy lets you review, correct and delete your data but does not promise a download, and the access rights in India\'s new data law are not enforceable until about May 2027.',
  ],
};
