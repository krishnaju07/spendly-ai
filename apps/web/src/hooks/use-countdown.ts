import { useEffect, useState } from 'react';

/** Start a countdown by creating a new object; `null` means none is running. */
export interface Cooldown {
  seconds: number;
}

/**
 * Whole seconds left in a countdown that begins when `cooldown` is a new object. Until the first
 * tick it reports the full duration, so a fresh countdown never flashes a wrong number.
 */
export function useCountdown(cooldown: Cooldown | null): number {
  const [state, setState] = useState<{ cooldown: Cooldown; left: number } | null>(null);
  useEffect(() => {
    if (!cooldown) return;
    const end = Date.now() + cooldown.seconds * 1000;
    const tick = () => setState({ cooldown, left: Math.max(0, Math.ceil((end - Date.now()) / 1000)) });
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [cooldown]);
  if (!cooldown) return 0;
  return state?.cooldown === cooldown ? state.left : cooldown.seconds;
}
