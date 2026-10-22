import type { AppGuide } from '../app-guide';

export const GUIDE_YOUTUBE_PREMIUM: AppGuide = {
  slug: 'youtube-premium',
  status: 'YouTube Premium offers no sign-in for apps like Spendly; upload a receipt instead.',
  ways: [
    {
      title: 'Save your Premium receipt as a PDF',
      accepts: 'PDF receipt (printed from the Premium billing page or a Google Play order)',
      importKind: 'receipt',
      steps: [
        'Open youtube.com/paid_memberships and sign in to the Google account that pays for Premium.',
        'If the charge is not there, open payments.google.com and choose Activity.',
        'If you paid through Google Play, open Google Play and go to "Budget & history", then open the order.',
        'Print the page and choose "Save as PDF" as the printer.',
        'Upload the PDF in Import and pick the receipt type.',
      ],
    },
    {
      title: 'Save the Google Play receipt email',
      accepts: '.eml email file',
      importKind: 'receipt',
      steps: [
        'Open your mail and search for "Google Play" and "receipt".',
        'Open the receipt email for your YouTube Premium charge.',
        'Save the email as an .eml file using your mail app download or save option.',
        'Upload the .eml file in Import and pick the receipt type.',
      ],
    },
  ],
  unverified: [
    'No Google or YouTube API scope exposes YouTube Premium billing or Google Play payment history, and the Play scopes of the Data Portability API cover only the EEA, Switzerland and the UK and leave out amounts.',
    'Google documents no export for the Premium billing page or the Play order history, so the PDF is a print of what you see on screen.',
    'Google Takeout has a "Google Pay" export, but its format is not stated and it is not confirmed that Premium charges are in it; Takeout archives take minutes to days to arrive and expire after about 7 days.',
    'Google says it sends a purchase email for Play and a price-change email at least 30 days ahead, but the sender, subject and fields of a real India Premium receipt are not confirmed.',
    'Third parties report the senders payments-noreply@google.com and googleplay-noreply@google.com, and one vendor cites the subject "Your receipt from Google Play".',
    'It is not confirmed that a Premium charge in India shows up as a Google Play order, and real receipts may come from Google instead of youtube.com, the sender domain listed for this app.',
  ],
};
