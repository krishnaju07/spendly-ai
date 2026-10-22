import type { AppGuide } from '../app-guide';

export const GUIDE_NETFLIX: AppGuide = {
  slug: 'netflix',
  status: 'No sign-in for apps like Spendly: Netflix has no public API for billing.',
  ways: [
    {
      title: 'Save an invoice from Payment History',
      accepts: 'PDF invoice',
      importKind: 'receipt',
      steps: [
        'Sign in to Netflix on a computer and open your account page.',
        'Open Payment History. It shows the last 12 months only.',
        'Open the invoice you want and choose to print it.',
        'In the print window, pick Save as PDF.',
        'In Spendly, open Import and upload the PDF.',
      ],
    },
    {
      title: 'Request your personal information',
      accepts: 'BillingHistory.csv from the export',
      importKind: 'generic',
      steps: [
        'Open netflix.com/account/getmyinfo and sign in.',
        'Request your personal information and finish the verification Netflix asks for.',
        'Wait for the export. Netflix says it can take up to 30 days from verification.',
        'When the ZIP arrives, unzip it and find BillingHistory.csv.',
        'In Spendly, open Import and upload BillingHistory.csv. You may need to map the columns on the next screen.',
      ],
    },
    {
      title: 'Get the bill from your partner',
      accepts: 'Partner bill or statement',
      importKind: 'auto',
      steps: [
        'Check if Airtel, Jio, Vi, Tata Play, ACT or Flipkart Plus pays for your Netflix. If so, that provider holds your billing history.',
        'Download the bill that shows the Netflix charge from that provider.',
        'In Spendly, open Import and upload the bill.',
      ],
    },
  ],
  unverified: [
    'Netflix says the personal information export can take up to 30 days from verification.',
    'A third-party guide says the ZIP has BillingHistory.csv with date, amount and plan, but we could not confirm the column names or the currency.',
    'We could not confirm that exports for accounts in India include BillingHistory.csv.',
    'Netflix lists info@mailer.netflix.com, info@account.netflix.com and info@members.netflix.com as its senders, but we could not confirm the subject lines of any receipt or renewal email.',
    'We also could not confirm that Netflix emails payment receipts in India at all.',
  ],
};
