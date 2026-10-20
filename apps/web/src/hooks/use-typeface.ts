import { useCallback, useState } from 'react';

export const DEFAULT_TYPEFACE = 'jakarta';

export const TYPEFACES = [
  { id: 'jakarta', name: 'Jakarta', fonts: 'Plus Jakarta Sans throughout', note: 'Warm, rounded and easy to read — the default.' },
  { id: 'studio', name: 'Studio', fonts: 'Sora figures · Geist text', note: 'Crisp and confident, a little technical.' },
  { id: 'grotesk', name: 'Grotesk', fonts: 'Bricolage figures · Manrope text', note: 'Characterful and modern.' },
] as const;

export type TypefaceId = (typeof TYPEFACES)[number]['id'];
const KEY = 'spendly-typeface';
const isId = (v: string | null): v is TypefaceId => TYPEFACES.some((t) => t.id === v);

export function readTypeface(): TypefaceId {
  try {
    const v = localStorage.getItem(KEY);
    if (isId(v)) return v;
  } catch {
    /* storage can be unavailable (private mode) — use the default */
  }
  return DEFAULT_TYPEFACE;
}

/** The typeface is a per-device display choice: it is kept in the browser and applied to <html> instantly. */
export function useTypeface() {
  const [typeface, setState] = useState<TypefaceId>(readTypeface);
  const setTypeface = useCallback((id: TypefaceId) => {
    setState(id);
    document.documentElement.dataset.typeface = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* ignore */
    }
  }, []);
  return { typeface, setTypeface };
}
