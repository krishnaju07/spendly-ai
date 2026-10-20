import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Anything that changes money data refreshes every figure on screen, but not the session or the catalog. */
export function useInvalidateMoney() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'catalog' }), [qc]);
}
