import { useEffect, type RefObject } from 'react';
import { prefersReducedMotion } from './use-reduced-motion';

/**
 * Publishes the pointer as CSS variables on an element: --mx/--my in pixels inside it (for a
 * spotlight) and --px/--py from -1 to 1 across the window (for parallax). Mouse and pen only —
 * touch screens and reduced-motion users get a still scene.
 */
export function usePointerVars(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || matchMedia('(pointer: coarse)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${e.clientX - r.left}px`);
        el.style.setProperty('--my', `${e.clientY - r.top}px`);
        el.style.setProperty('--px', String((e.clientX / innerWidth - 0.5) * 2));
        el.style.setProperty('--py', String((e.clientY / innerHeight - 0.5) * 2));
      });
    };
    addEventListener('pointermove', onMove, { passive: true });
    return () => {
      removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
}
