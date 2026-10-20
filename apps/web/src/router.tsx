import { Navigate, createBrowserRouter, useLocation } from 'react-router';
import { Link } from 'react-router';
import { AppShell, RouteError } from '@/components/layout/app-shell';
import { ErrorState } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { Logo } from '@/components/layout/logo';
import type { ReactNode } from 'react';

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading Spendly">
      <div className="animate-pulse"><Logo /></div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error, retry } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <Splash />;
  // offline or a server hiccup is not the same as being signed out: say so instead of bouncing to the sign-in screen
  if (status === 'error') return <div className="grid min-h-dvh place-items-center px-4"><ErrorState error={error} onRetry={retry} /></div>;
  if (status === 'anon') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="type-hero text-[72px] leading-none">404</p>
        <p className="mt-3 text-muted-foreground">That page does not exist.</p>
        <Button asChild className="mt-6"><Link to="/">Back to overview</Link></Button>
      </div>
    </div>
  );
}

const page = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

const authPage = async () => ({ Component: (await import('@/pages/login')).default });

export const router = createBrowserRouter([
  // sign in and create-account are one page (it reads the path), so the scene stays mounted while the card morphs
  { path: '/login', HydrateFallback: Splash, lazy: authPage },
  { path: '/register', HydrateFallback: Splash, lazy: authPage },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    HydrateFallback: Splash,
    children: [
      { index: true, lazy: page(() => import('@/pages/overview')) },
      { path: 'transactions', lazy: page(() => import('@/pages/transactions')) },
      { path: 'platforms', lazy: page(() => import('@/pages/platforms')) },
      { path: 'platforms/:slug', lazy: page(() => import('@/pages/platform-detail')) },
      { path: 'analytics', lazy: page(() => import('@/pages/analytics')) },
      { path: 'coach', lazy: page(() => import('@/pages/coach')) },
      { path: 'budgets', lazy: page(() => import('@/pages/budgets')) },
      { path: 'recurring', lazy: page(() => import('@/pages/recurring')) },
      { path: 'goals', lazy: page(() => import('@/pages/goals')) },
      { path: 'import', lazy: page(() => import('@/pages/import-center')) },
      { path: 'import/:id', lazy: page(() => import('@/pages/import-job')) },
      { path: 'reports', lazy: page(() => import('@/pages/reports')) },
      { path: 'settings', lazy: page(() => import('@/pages/settings')) },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
