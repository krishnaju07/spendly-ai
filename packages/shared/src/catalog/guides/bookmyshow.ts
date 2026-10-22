import type { AppGuide } from '../app-guide';

export const GUIDE_BOOKMYSHOW: AppGuide = {
  slug: 'bookmyshow',
  status: 'BookMyShow offers no sign-in for apps like Spendly.',
  ways: [
    {
      title: 'Save the booking confirmation email',
      accepts: '.eml email',
      importKind: 'receipt',
      steps: [
        'Open the email app you booked with and search for "BookMyShow".',
        'Open the booking confirmation email for the show you want.',
        'Save that email as an .eml file, using your email app\'s download or export option.',
        'Open Import in Spendly and pick the receipt file type.',
        'Upload the .eml file.',
      ],
    },
    {
      title: 'Save the ticket or invoice from Purchase History',
      accepts: 'PDF or photo of the ticket/invoice',
      importKind: 'receipt',
      steps: [
        'Open the BookMyShow app and sign in.',
        'Go to Purchase History.',
        'Tap the booking you want.',
        'Save the ticket or invoice, or take a screenshot of it.',
        'Upload the file or photo in Import, as a receipt.',
      ],
    },
  ],
  unverified: [
    'The confirmation email may come from tickets@bookmyshow.email with the subject "Your Tickets", but this was seen in only one example, so check your own inbox.',
    'Only a 2023 copy of the email was seen. It showed the movie, venue, screen, date, time, seats and total. Newer layouts, and whether events and sports bookings look the same, could not be confirmed.',
    'BookMyShow does not document any way to export or download an invoice inside the app, so saving the ticket screen or taking a screenshot may be all that is possible.',
    'An unofficial listing gives allears@bookmyshow.com for data requests, but what such a request returns is not confirmed. Your right to ask for your data under India\'s DPDP law can be enforced only from about 13 May 2027.',
  ],
};
