import type { TransactionType } from '../constants';

export type CategoryKind = 'spending' | 'income' | 'transfer';

export interface CategoryDef {
  slug: string;
  name: string;
  kind: CategoryKind;
  /** lucide-react icon component name; the web app maps it to the component. */
  icon: string;
  /**
   * Preferred categorical colour slot (1–8) from the validated chart palette, or null for the
   * neutral tail. Slots may be shared between related categories; a chart resolves conflicts for
   * the categories it actually shows (see `assignSlots` in the web chart helpers).
   */
  slot: number | null;
  /** Spending that is a choice rather than an obligation — drives "discretionary" insights. */
  discretionary: boolean;
  subcategories: string[];
  defaultType: TransactionType;
}

export const CATEGORIES: readonly CategoryDef[] = [
  {
    slug: 'food-delivery',
    name: 'Food delivery',
    kind: 'spending',
    icon: 'Bike',
    slot: 2,
    discretionary: true,
    subcategories: ['Restaurant orders', 'Late-night orders', 'Memberships'],
    defaultType: 'expense',
  },
  {
    slug: 'dining-out',
    name: 'Dining out',
    kind: 'spending',
    icon: 'UtensilsCrossed',
    slot: 4,
    discretionary: true,
    subcategories: ['Restaurants', 'Cafes', 'Bars & pubs'],
    defaultType: 'expense',
  },
  {
    slug: 'groceries',
    name: 'Groceries',
    kind: 'spending',
    icon: 'ShoppingBasket',
    slot: 6,
    discretionary: false,
    subcategories: ['Quick commerce', 'Supermarket', 'Fruits & vegetables', 'Dairy & essentials'],
    defaultType: 'expense',
  },
  {
    slug: 'entertainment',
    name: 'Entertainment',
    kind: 'spending',
    icon: 'Clapperboard',
    slot: 7,
    discretionary: true,
    subcategories: ['Movies', 'Events & concerts', 'Gaming', 'Sports & activities'],
    defaultType: 'expense',
  },
  {
    slug: 'shopping',
    name: 'Shopping',
    kind: 'spending',
    icon: 'ShoppingBag',
    slot: 5,
    discretionary: true,
    subcategories: ['Online shopping', 'Fashion', 'Electronics', 'Home & living', 'Malls & stores'],
    defaultType: 'expense',
  },
  {
    slug: 'transport',
    name: 'Travel & transport',
    kind: 'spending',
    icon: 'Plane',
    slot: 1,
    discretionary: false,
    subcategories: ['Cabs & autos', 'Trains', 'Flights', 'Hotels & stays', 'Public transit', 'Tolls & parking'],
    defaultType: 'expense',
  },
  {
    slug: 'subscriptions',
    name: 'Subscriptions',
    kind: 'spending',
    icon: 'Repeat',
    slot: 3,
    discretionary: true,
    subcategories: ['Streaming', 'Music', 'Cloud & software', 'Gaming', 'Memberships'],
    defaultType: 'expense',
  },
  {
    slug: 'bills',
    name: 'Bills & utilities',
    kind: 'spending',
    icon: 'Zap',
    slot: 4,
    discretionary: false,
    subcategories: ['Electricity', 'Water & gas', 'Internet & mobile', 'DTH & cable', 'Loan EMI', 'Insurance'],
    defaultType: 'expense',
  },
  {
    slug: 'rent',
    name: 'Rent & housing',
    kind: 'spending',
    icon: 'House',
    slot: 8,
    discretionary: false,
    subcategories: ['Rent', 'Maintenance', 'Home services'],
    defaultType: 'expense',
  },
  {
    slug: 'fuel',
    name: 'Fuel',
    kind: 'spending',
    icon: 'Fuel',
    slot: 1,
    discretionary: false,
    subcategories: ['Petrol', 'Diesel', 'CNG & EV charging'],
    defaultType: 'expense',
  },
  {
    slug: 'health',
    name: 'Health & medical',
    kind: 'spending',
    icon: 'HeartPulse',
    slot: 8,
    discretionary: false,
    subcategories: ['Doctors & clinics', 'Pharmacy', 'Diagnostics', 'Health insurance'],
    defaultType: 'expense',
  },
  {
    slug: 'education',
    name: 'Education',
    kind: 'spending',
    icon: 'GraduationCap',
    slot: 7,
    discretionary: false,
    subcategories: ['Tuition & fees', 'Courses', 'Books & supplies'],
    defaultType: 'expense',
  },
  {
    slug: 'personal-care',
    name: 'Personal care & fitness',
    kind: 'spending',
    icon: 'Sparkles',
    slot: 5,
    discretionary: true,
    subcategories: ['Salon & spa', 'Gym & fitness', 'Wellness'],
    defaultType: 'expense',
  },
  {
    slug: 'gifts',
    name: 'Gifts & donations',
    kind: 'spending',
    icon: 'Gift',
    slot: 5,
    discretionary: true,
    subcategories: ['Gifts', 'Donations'],
    defaultType: 'expense',
  },
  {
    slug: 'cash',
    name: 'Cash & ATM',
    kind: 'spending',
    icon: 'Banknote',
    slot: null,
    discretionary: false,
    subcategories: ['ATM withdrawal'],
    defaultType: 'expense',
  },
  {
    slug: 'fees',
    name: 'Fees & charges',
    kind: 'spending',
    icon: 'Receipt',
    slot: null,
    discretionary: false,
    subcategories: ['Bank charges', 'Card fees', 'Interest & late fees', 'Taxes'],
    defaultType: 'expense',
  },
  {
    slug: 'other',
    name: 'Other',
    kind: 'spending',
    icon: 'CircleEllipsis',
    slot: null,
    discretionary: false,
    subcategories: [],
    defaultType: 'expense',
  },
  {
    slug: 'income',
    name: 'Income',
    kind: 'income',
    icon: 'ArrowDownToLine',
    slot: null,
    discretionary: false,
    subcategories: ['Salary', 'Freelance', 'Interest', 'Dividends', 'Reimbursements', 'Other income'],
    defaultType: 'income',
  },
  {
    slug: 'investments',
    name: 'Investments & savings',
    kind: 'transfer',
    icon: 'TrendingUp',
    slot: null,
    discretionary: false,
    subcategories: ['Mutual funds & SIPs', 'Stocks', 'Fixed deposits', 'Retirement'],
    defaultType: 'transfer',
  },
  {
    slug: 'transfers',
    name: 'Transfers',
    kind: 'transfer',
    icon: 'ArrowLeftRight',
    slot: null,
    discretionary: false,
    subcategories: ['Credit card bill', 'Own accounts', 'Wallet top-up'],
    defaultType: 'transfer',
  },
];

export const CATEGORY_BY_SLUG: ReadonlyMap<string, CategoryDef> = new Map(
  CATEGORIES.map((c) => [c.slug, c]),
);

export const SPENDING_CATEGORY_SLUGS: readonly string[] = CATEGORIES.filter(
  (c) => c.kind === 'spending',
).map((c) => c.slug);

export const DISCRETIONARY_CATEGORY_SLUGS: readonly string[] = CATEGORIES.filter(
  (c) => c.discretionary,
).map((c) => c.slug);

export const UNCATEGORIZED_SLUG = 'other';

export function categoryName(slug: string | null | undefined): string {
  if (!slug) return 'Uncategorized';
  return CATEGORY_BY_SLUG.get(slug)?.name ?? slug.replace(/^custom-/, '').replace(/-/g, ' ');
}
