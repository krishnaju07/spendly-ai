import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthResultDto, MeDto, OtpRequestResultDto, PreferencesDto, PreferencesUpdate, UserDto } from '@spendly/shared';
import { ApiRequestError, api, onUnauthorized, setCsrfToken } from '@/lib/api';
import { useTheme } from '@/hooks/use-theme';

interface AuthContextValue {
  /** `error` means the server could not be reached or failed — not that the user is signed out. */
  status: 'loading' | 'authed' | 'anon' | 'error';
  error: unknown;
  retry: () => void;
  user: UserDto | null;
  prefs: PreferencesDto | null;
  isDemo: boolean;
  /** Texts a sign-in code. Does not change who is signed in. */
  requestCode: (phone: string) => Promise<OtpRequestResultDto>;
  /** `needs_name`: the code was right but the number is new — call again with a name. */
  verifyCode: (input: { phone: string; otp: string; name?: string; tracked?: string[] }) => Promise<{ status: 'needs_name' } | { status: 'signed_in'; isNew: boolean }>;
  startDemo: () => Promise<void>;
  logout: () => Promise<void>;
  updatePrefs: (patch: PreferencesUpdate) => Promise<PreferencesDto>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ME = ['me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setTheme } = useTheme();

  const me = useQuery({
    queryKey: ME,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        return await api.get<MeDto>('/auth/me');
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 401) return null;
        throw error;
      }
    },
  });

  const data = me.data ?? null;
  useEffect(() => {
    if (data) {
      setCsrfToken(data.csrfToken);
      setTheme(data.preferences.theme);
    }
  }, [data, setTheme]);

  useEffect(
    () =>
      onUnauthorized(() => {
        setCsrfToken(null);
        qc.clear();
        qc.setQueryData(ME, null);
      }),
    [qc],
  );

  const adopt = useCallback(
    (body: MeDto) => {
      setCsrfToken(body.csrfToken);
      qc.clear();
      qc.setQueryData(ME, body);
    },
    [qc],
  );

  const requestCode = useMutation({ mutationFn: (phone: string) => api.post<OtpRequestResultDto>('/auth/otp/request', { phone }) });
  const verifyCode = useMutation({
    mutationFn: (v: { phone: string; otp: string; name?: string; tracked?: string[] }) => api.post<AuthResultDto>('/auth/otp/verify', v),
    onSuccess: (r) => {
      if (r.status === 'signed_in') adopt({ user: r.user, preferences: r.preferences, csrfToken: r.csrfToken });
    },
  });
  const demo = useMutation({ mutationFn: () => api.post<MeDto>('/auth/demo'), onSuccess: adopt });
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      setCsrfToken(null);
      qc.clear();
      qc.setQueryData(ME, null);
    },
  });
  const prefsMutation = useMutation({
    mutationFn: (patch: PreferencesUpdate) => api.patch<PreferencesDto>('/settings/preferences', patch),
    onSuccess: (prefs) => {
      qc.setQueryData<MeDto | null>(ME, (old) => (old ? { ...old, preferences: prefs } : old));
      setTheme(prefs.theme);
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      status: me.isPending ? 'loading' : data ? 'authed' : me.isError ? 'error' : 'anon',
      error: me.error,
      retry: () => void me.refetch(),
      user: data?.user ?? null,
      prefs: data?.preferences ?? null,
      isDemo: data?.user.isDemo ?? false,
      requestCode: (phone) => requestCode.mutateAsync(phone),
      verifyCode: async (input) => {
        const r = await verifyCode.mutateAsync(input);
        return r.status === 'signed_in' ? { status: 'signed_in', isNew: r.isNew } : { status: 'needs_name' };
      },
      startDemo: async () => void (await demo.mutateAsync()),
      logout: async () => void (await logout.mutateAsync()),
      updatePrefs: (patch) => prefsMutation.mutateAsync(patch),
    }),
    [me, data, requestCode, verifyCode, demo, logout, prefsMutation],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens that only render when signed in. */
export function useSession() {
  const a = useAuth();
  if (!a.user || !a.prefs) throw new Error('useSession outside an authenticated route');
  return { ...a, user: a.user, prefs: a.prefs };
}
