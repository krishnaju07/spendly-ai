/** True when the user asked the system to cut back on motion. Read once; the CSS handles the rest. */
export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
