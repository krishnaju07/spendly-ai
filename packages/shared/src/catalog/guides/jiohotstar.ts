import type { AppGuide } from '../app-guide';

export const GUIDE_JIOHOTSTAR: AppGuide = {
  slug: 'jiohotstar',
  status: 'JioHotstar offers no sign-in or receipts Spendly can read.',
  ways: [
    {
      title: 'Save the Google Play or App Store receipt',
      accepts: 'PDF or .eml receipt',
      importKind: 'receipt',
      steps: [
        'Use this only if you bought JioHotstar through Google Play or the App Store.',
        'Open your email and search for "Your receipt from Google Play", or for Apple\'s receipt email.',
        'Open the receipt for JioHotstar. It shows the order ID, date and renewal terms.',
        'Save it as a PDF, or download it as an .eml file.',
        'Upload it in Import and choose receipt.',
      ],
    },
    {
      title: 'Save the payment details from the app',
      accepts: 'Screenshot or saved page of your payment details',
      importKind: 'receipt',
      steps: [
        'Open the JioHotstar app and sign in with your mobile number.',
        'Go to My Space, then Help & Settings, then Account Settings.',
        'Look for Subscription or payment details. Your app may not show them.',
        'If you see a payment, take a screenshot or save the page.',
        'Upload it in Import and choose receipt.',
      ],
    },
    {
      title: 'Upload the statement that shows the debit',
      accepts: 'your UPI or card statement',
      importKind: 'auto',
      steps: [
        'This may be your only route, because JioHotstar gives no receipts of its own. Your payment alerts are the record.',
        'Open your UPI app or bank app, the one that pays for JioHotstar.',
        'Download the statement or UPI export for the months you want.',
        'Check that the JioHotstar debits show in it.',
        'Upload it in Import and let Spendly detect the type.',
      ],
    },
  ],
  unverified: [
    'We found no developer portal, sign-in for apps, billing API or data export from JioHotstar.',
    'We could not confirm that the app has a payment history screen. One outside post says it may be under Subscription.',
    'We found no sender domain, email subject or SMS sender ID for JioHotstar\'s own receipts or alerts.',
    'If JioHotstar comes with a telco plan such as Vi, it is part of your recharge or postpaid bill, not a separate charge. Jio and Airtel are likely the same, but we could not confirm this.',
    'India\'s data protection rules give only a summary of your data, and those parts apply from about 13 May 2027.',
  ],
};
