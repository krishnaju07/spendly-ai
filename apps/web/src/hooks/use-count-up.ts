import { useEffect, useRef, useState } from 'react';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eases a number toward its target: from zero on first paint, from wherever it is on later changes. */
export function useCountUp(target: number, enabled = true, duration = 1000): number {
  const skip = !enabled || reducedMotion();
  const [value, setValue] = useState(skip ? target : 0);
  const current = useRef(skip ? target : 0);

  useEffect(() => {
    if (skip) return;
    const from = current.current;
    if (from === target) return;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const v = Math.round(from + (target - from) * (1 - (1 - t) ** 4));
      current.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, skip, duration]);

  return skip ? target : value;
}
