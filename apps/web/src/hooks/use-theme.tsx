import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemePreference;
  resolved: Resolved;
  setTheme: (t: ThemePreference) => void;
}

const KEY = 'spendly-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage can be unavailable (private mode) — fall back to the default look */
  }
  return 'dark';
}

const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

function apply(r: Resolved) {
  const root = document.documentElement;
  root.classList.toggle('dark', r === 'dark');
  root.dataset.theme = r;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute('content', r === 'dark' ? '#08090B' : '#F5F6FA');
    m.removeAttribute('media');
  });
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(read);
  // the OS setting only matters while the preference is "system"; it arrives as an event, not inside an effect body
  const [osDark, setOsDark] = useState(systemDark);
  const resolved: Resolved = theme === 'system' ? (osDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    apply(resolved);
  }, [resolved]);

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setOsDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((t: ThemePreference) => {
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
    setThemeState(t);
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
