import type { AppGuide } from '../app-guide';

export const GUIDE_PAYTM_INSIDER: AppGuide = {
  slug: 'paytm-insider',
  status: 'No sign-in for apps like Spendly; Insider appears to have merged into District.',
  ways: [
    {
      title: 'Save the booking email',
      accepts: '.eml email',
      importKind: 'receipt',
      steps: [
        'Search your email for the Insider or District booking confirmation.',
        'Open the confirmation email.',
        'Choose the option to download or save the message as an .eml file.',
        'Open Import in Spendly and pick the receipt file type.',
        'Upload the .eml file.',
      ],
    },
    {
      title: 'Save or screenshot your ticket',
      accepts: 'PDF or photo of the ticket',
      importKind: 'receipt',
      steps: [
        'Open your booking or ticket page in the app you booked with.',
        'Save the page as a PDF if the app lets you, or take a screenshot.',
        'Check that the amount, date and event name are visible.',
        'Open Import in Spendly and pick the receipt file type.',
        'Upload the PDF or screenshot.',
      ],
    },
  ],
  unverified: [
    'insider.in redirected to district.in when we fetched it on 21 October 2026, so Paytm Insider appears to have merged into District.',
    'We saw this in one fetch and one other source, and we could not confirm whether old Insider booking history moved into District accounts.',
    'We could not read the Insider privacy policy, so we do not know if it has an export tool or a contact for data requests.',
    'We could not confirm the sender address or subject line of Insider booking emails, or whether the amount, date and event name are in the body.',
    'Your legal right to ask for your data under India\'s DPDP law can be enforced only from about 13 May 2027.',
  ],
};
