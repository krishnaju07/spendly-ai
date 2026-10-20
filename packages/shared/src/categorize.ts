import type { TransactionType } from './constants';

/**
 * Keyword rules that classify spending which no platform pattern claimed, and that detect
 * transaction *types* (transfers, income, refunds) regardless of platform. Rules run against
 * normalised text in priority order; the first match per concern wins.
 */

export interface KeywordRule {
  id: string;
  pattern: RegExp;
  category: string;
  subcategory?: string;
  /** Sets the transaction type (transfer/income/refund) rather than only the category. */
  type?: TransactionType;
  /** Only applies when the statement says the money moved this way. */
  direction?: 'debit' | 'credit';
  confidence: number;
  reason: string;
  /** Friendly merchant name for narrations that carry only banking noise ("CREDIT CARD PAYMENT HDFC 4012"). */
  displayName?: string;
}

const r = (source: string) => new RegExp(source);

export const KEYWORD_RULES: readonly KeywordRule[] = [
  {
    id: 'cc-bill-payment',
    pattern: r(
      '\\b(CREDIT ?CARD|CREDITCARD|CC) ?(BILL ?)?(PAYMENT|PMT|PAYMT|AUTOPAY|AUTO PAY|BILLPAY|BILL)\\b|\\bCRED( CLUB)?\\b|\\bPAYMENT RECEIVED\\b|\\b(BILLDESK|BILLPAY)\\b.*\\b(CREDIT ?CARD|CC|HDFCCC|ICICICC|SBICARD|AXISCC)\\b',
    ),
    category: 'transfers',
    subcategory: 'Credit card bill',
    type: 'transfer',
    confidence: 0.9,
    reason: 'Looks like a credit card bill payment — the spending is counted on the card, so this is a transfer',
    displayName: 'Credit card bill payment',
  },
  {
    id: 'own-account',
    pattern: r('\\b(SELF TRANSFER|OWN ACCOUNT|OWN A C|TO SELF|FROM SELF|SWEEP IN|SWEEP OUT)\\b'),
    category: 'transfers',
    subcategory: 'Own accounts',
    type: 'transfer',
    confidence: 0.86,
    reason: 'Looks like a transfer between your own accounts',
    displayName: 'Transfer to own account',
  },
  {
    id: 'investments',
    pattern: r(
      '\\b(ZERODHA|GROWW|UPSTOX|KUVERA|ANGEL ?ONE|5PAISA|MUTUAL FUND|SIP|NSE CLEARING|INDIAN CLEARING CORP|ICCL|NSDL|CDSL|NPS|PPF|FIXED DEPOSIT|FD BOOKING|RD INSTALLMENT|RECURRING DEPOSIT|SMALLCASE|ET ?MONEY|BSE STAR MF)\\b',
    ),
    category: 'investments',
    subcategory: 'Mutual funds & SIPs',
    type: 'transfer',
    direction: 'debit',
    confidence: 0.86,
    reason: 'Looks like an investment or savings contribution, which is not spending',
  },
  {
    id: 'atm',
    pattern: r('\\b(ATM WDL|ATM CASH|ATM|NWD|CASH WITHDRAWAL|CASH WDL|ATW)\\b'),
    category: 'cash',
    subcategory: 'ATM withdrawal',
    direction: 'debit',
    confidence: 0.9,
    reason: 'Cash withdrawal — counted as spending under "Cash & ATM"',
    displayName: 'ATM withdrawal',
  },
  {
    id: 'salary',
    pattern: r('\\b(SALARY|SAL CREDIT|PAYROLL|WAGES)\\b'),
    category: 'income',
    subcategory: 'Salary',
    type: 'income',
    direction: 'credit',
    confidence: 0.92,
    reason: 'Looks like a salary credit',
  },
  {
    id: 'interest-credit',
    pattern: r('\\b(INT PD|INT PAID|INTEREST PAID|CREDIT INTEREST|INT CR|SAVINGS INTEREST|INTEREST CREDIT)\\b'),
    category: 'income',
    subcategory: 'Interest',
    type: 'income',
    direction: 'credit',
    confidence: 0.88,
    reason: 'Looks like bank interest',
    displayName: 'Interest credit',
  },
  {
    id: 'dividend',
    pattern: r('\\bDIVIDEND\\b'),
    category: 'income',
    subcategory: 'Dividends',
    type: 'income',
    direction: 'credit',
    confidence: 0.88,
    reason: 'Looks like a dividend payout',
    displayName: 'Dividend',
  },
  {
    id: 'refund',
    pattern: r('\\b(REFUND|REFUNDED|REVERSAL|REVERSED|CHARGEBACK|CASHBACK|CASH BACK|RETURNED)\\b'),
    category: 'other',
    type: 'refund',
    direction: 'credit',
    confidence: 0.84,
    reason: 'Looks like a refund, reversal or cashback — it reduces net spending instead of counting as income',
  },
  {
    id: 'fees',
    pattern: r(
      '\\b(ANNUAL FEE|JOINING FEE|LATE PAYMENT|LATE FEE|FINANCE CHARGES?|INTEREST CHARGED|SMS ALERT|SMS CHARGES|ATM CHARGES|MIN BAL|MIN BALANCE|NON MAINTENANCE|CHARGES|CHRGS|CHRG|IGST|CGST|SGST|PROCESSING FEE|CONVENIENCE FEE|FOREX MARKUP|PENALTY)\\b',
    ),
    category: 'fees',
    subcategory: 'Bank charges',
    direction: 'debit',
    confidence: 0.8,
    reason: 'Looks like a bank or card fee',
  },
  {
    id: 'emi',
    pattern: r('\\b(EMI|HOME LOAN|CAR LOAN|PERSONAL LOAN|LOAN REPAYMENT|BAJAJ FINSERV|BAJAJ FINANCE)\\b'),
    category: 'bills',
    subcategory: 'Loan EMI',
    direction: 'debit',
    confidence: 0.8,
    reason: 'Looks like a loan repayment',
  },
  {
    id: 'insurance',
    pattern: r(
      '\\b(LIFE INSURANCE|INSURANCE PREMIUM|INSURANCE|LIC|HDFC LIFE|ICICI PRU|ICICI PRUDENTIAL|STAR HEALTH|BAJAJ ALLIANZ|MAX LIFE|POLICYBAZAAR|ACKO|NIVA BUPA|CARE HEALTH)\\b',
    ),
    category: 'bills',
    subcategory: 'Insurance',
    direction: 'debit',
    confidence: 0.8,
    reason: 'Looks like an insurance premium',
  },
  {
    id: 'groceries',
    pattern: r(
      '\\b(SUPERMARKET|SUPER MARKET|KIRANA|GROCERY|GROCERIES|DMART|D MART|AVENUE SUPERMARTS|RELIANCE FRESH|RELIANCE SMART|MORE RETAIL|SPAR|NATURE S BASKET|NATURES BASKET|VEGETABLES|FRUITS|DAIRY|STAR BAZAAR|JIOMART)\\b',
    ),
    category: 'groceries',
    subcategory: 'Supermarket',
    confidence: 0.82,
    reason: 'Merchant text looks like a grocery store',
  },
  {
    id: 'personal-care',
    pattern: r(
      '\\b(SALON|SPA|GYM|CULT ?FIT|URBAN COMPANY|URBANCLAP|LAKME|JAWED HABIB|NATURALS|BARBER|HAIRCUT|FITNESS|YOGA|WELLNESS)\\b',
    ),
    category: 'personal-care',
    confidence: 0.8,
    reason: 'Merchant text looks like a salon, gym or wellness provider',
  },
  {
    id: 'shopping',
    pattern: r(
      '\\b(DECATHLON|IKEA|CROMA|RELIANCE DIGITAL|NYKAA|LIFESTYLE|PANTALOONS|WESTSIDE|MAX FASHION|ZUDIO|H AND M|UNIQLO|TANISHQ|SHOPPERS STOP|VIJAY SALES|BATA|PUMA|NIKE|ADIDAS)\\b',
    ),
    category: 'shopping',
    confidence: 0.8,
    reason: 'Merchant text looks like a retail brand',
  },
  {
    id: 'gifts',
    pattern: r('\\b(DONATION|CHARITY|NGO|GIVEINDIA|TEMPLE|CRY INDIA|GIFT|GIFTS)\\b'),
    category: 'gifts',
    confidence: 0.78,
    reason: 'Looks like a gift or donation',
  },
  {
    id: 'transit',
    pattern: r('\\b(METRO|DMRC|BMTC|KSRTC|MSRTC|FASTAG|TOLL|PARKING|REDBUS|ABHIBUS|TAXI|CAB|NAMMA YATRI)\\b'),
    category: 'transport',
    subcategory: 'Public transit',
    confidence: 0.8,
    reason: 'Merchant text looks like transport',
  },
  {
    id: 'entertainment',
    pattern: r('\\b(CONCERT|MUSEUM|AMUSEMENT|WONDERLA|IMAGICA|BOWLING|ARCADE|ESCAPE ROOM|DREAM11|MPL|TICKETS?)\\b'),
    category: 'entertainment',
    confidence: 0.75,
    reason: 'Merchant text looks like entertainment',
  },
];

export interface KeywordMatch {
  rule: KeywordRule;
}

/** First keyword rule that applies to `text` for the given statement direction. */
export function matchKeywordRule(
  text: string,
  direction: 'debit' | 'credit' | null,
  predicate: (rule: KeywordRule) => boolean = () => true,
): KeywordRule | null {
  for (const rule of KEYWORD_RULES) {
    if (!predicate(rule)) continue;
    if (rule.direction && direction && rule.direction !== direction) continue;
    if (rule.pattern.test(text)) return rule;
  }
  return null;
}
