import { useQuery } from '@tanstack/react-query';
import type { AuthConfigDto } from '@spendly/shared';
import { api } from '@/lib/api';

/** How sign-in codes reach people on this server (text message, on-screen in development, or not at all). */
export function useAuthConfig() {
  return useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<AuthConfigDto>('/auth/config'), staleTime: 5 * 60_000, retry: 1 });
}
