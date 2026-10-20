import { useEffect, useState } from 'react';
import { Outlet, useLocation, useRouteError } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { navForPath } from '@/lib/nav';
import { ErrorState } from '@/components/common/states';
import { TransactionPanelProvider, useTransactionPanel } from '@/components/transactions/transaction-panel';
import { DemoBanner, OfflineBanner } from './banners';
import { BottomNav } from './bottom-nav';
import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';
import { TopBar } from './top-bar';

function Inner() {
  const { openNew } = useTransactionPanel();
  const [search, setSearch] = useState(false);
  const { pathname } = useLocation();
  // the tab and the installed-app window say where you are
  useEffect(() => {
    document.title = `${navForPath(pathname)?.label ?? 'Spendly'} · Spendly`;
  }, [pathname]);
  return (
    <>
      <a href="#main" className="sr-only z-[60] rounded-full bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <DemoBanner />
      <OfflineBanner />
      <div className="mx-auto flex w-full max-w-[1680px] items-start gap-4 p-3 pr-[max(0.75rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] md:p-4">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <TopBar onSearch={() => setSearch(true)} />
          <main id="main" tabIndex={-1} className="min-w-0 pb-32 outline-none md:pb-10">
            {/* keyed by path so each page eases in; filter and range changes in the URL do not replay it */}
            <div key={pathname} className="page-enter">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <BottomNav onAdd={() => openNew()} />
      <CommandPalette open={search} onOpenChange={setSearch} onAdd={() => openNew()} />
    </>
  );
}

export function AppShell() {
  return (
    <TooltipProvider delayDuration={150}>
      <TransactionPanelProvider>
        <Inner />
      </TransactionPanelProvider>
    </TooltipProvider>
  );
}

/** Rendered when a page throws — keeps the shell and offers a way forward. */
export function RouteError() {
  const error = useRouteError();
  return (
    <div className="mx-auto max-w-lg py-20">
      <ErrorState error={error instanceof Error ? error : new Error('This page hit an unexpected problem.')} onRetry={() => location.reload()} />
    </div>
  );
}
