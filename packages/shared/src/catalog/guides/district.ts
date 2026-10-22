import type { AppGuide } from '../app-guide';

export const GUIDE_DISTRICT: AppGuide = {
  slug: 'district',
  status: 'No sign-in for apps like Spendly: District has no API or login for your own history.',
  ways: [
    {
      title: 'Save the booking email',
      accepts: '.eml email',
      importKind: 'receipt',
      steps: [
        'Open the booking confirmation email from District in your email app.',
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
        'Open your booking or ticket page in the District app.',
        'Save the page as a PDF if the app lets you, or take a screenshot.',
        'Check that the amount, date and event name are visible.',
        'Open Import in Spendly and pick the receipt file type.',
        'Upload the PDF or screenshot.',
      ],
    },
  ],
  unverified: [
    'We could not confirm the sender address or subject line of District booking emails, or whether the amount, date and event name are in the email body.',
    'District\'s booking terms say confirmations are sent by email and by SMS or WhatsApp, and we did not check what each one shows.',
    'District\'s privacy policy (August 2026) has no tool to export your booking history.',
    'The policy sends requests to privacy@zomato.com and states no turnaround time.',
    'Your legal right to ask for your data under India\'s DPDP law can be enforced only from about 13 May 2027.',
  ],
};
