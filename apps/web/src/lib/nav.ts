import { ArrowLeftRight, ChartNoAxesColumn, FileText, FileUp, Gauge, LayoutDashboard, PiggyBank, Repeat, Settings, Sparkles, Store, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: LucideIcon;
  end?: boolean;
  /** Pages whose data follows the global date range show the range picker in the top bar. */
  range?: boolean;
  /** Still a page (it has a title and a route) but not offered in the sidebar, the tab bar or the "Go to" list. */
  hidden?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', short: 'Home', icon: LayoutDashboard, end: true, range: true },
  { to: '/transactions', label: 'Transactions', short: 'Activity', icon: ArrowLeftRight, range: true },
  { to: '/platforms', label: 'Platforms', short: 'Platforms', icon: Store, range: true },
  { to: '/analytics', label: 'Spending Analytics', short: 'Analytics', icon: ChartNoAxesColumn, range: true },
  { to: '/coach', label: 'AI Money Coach', short: 'Coach', icon: Sparkles },
  { to: '/budgets', label: 'Budgets', short: 'Budgets', icon: Gauge },
  { to: '/recurring', label: 'Recurring Payments', short: 'Recurring', icon: Repeat },
  { to: '/goals', label: 'Savings Goals', short: 'Goals', icon: PiggyBank },
  // reached from Settings > Your data, and from the empty states that need it
  { to: '/import', label: 'Import & Sync', short: 'Import', icon: FileUp, hidden: true },
  { to: '/reports', label: 'Reports', short: 'Reports', icon: FileText, range: true },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
];

/** What the sidebar, the tab bar and the command palette offer. */
export const MAIN_NAV = NAV.filter((n) => !n.hidden);

export const BOTTOM_TABS = ['/', '/transactions', '/coach'] as const;

export function navForPath(pathname: string): NavItem | undefined {
  return NAV.find((n) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(`${n.to}/`)));
}
