import { useCallback, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  // a stable subscribe function: a new one on every render makes React detach and re-attach the listener each time
  const subscribe = useCallback(
    (notify: () => void) => {
      const mq = matchMedia(query);
      mq.addEventListener('change', notify);
      return () => mq.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches, () => false);
}

export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');
