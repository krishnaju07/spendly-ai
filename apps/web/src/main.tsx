import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { UpdatePrompt } from '@/components/layout/banners';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/hooks/use-auth';
import { ThemeProvider } from '@/hooks/use-theme';
import { ApiRequestError } from '@/lib/api';
import { router } from '@/router';
import './index.css';
import './styles/fonts-extra.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // client errors will not fix themselves; transient ones get a couple of tries. A timeout is not retried quietly:
      // three 20-second waits behind a skeleton looks like a frozen app, so say so and offer "Try again".
      retry: (count, error) => !(error instanceof ApiRequestError && ((error.status >= 400 && error.status < 500) || error.code === 'TIMEOUT')) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          {/* app-wide: the service worker registers on the first page, signed in or not, and toasts work everywhere */}
          <UpdatePrompt />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
