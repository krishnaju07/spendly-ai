import { useSyncExternalStore } from 'react';

export function useOnline(): boolean {
  return useSyncExternalStore(
    (notify) => {
      addEventListener('online', notify);
      addEventListener('offline', notify);
      return () => {
        removeEventListener('online', notify);
        removeEventListener('offline', notify);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}
