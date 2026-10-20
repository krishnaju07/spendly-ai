import { useLayoutEffect, useRef } from 'react';

const ACTIVE = '[data-state="active"], [aria-checked="true"], [aria-current="page"], [aria-selected="true"]';
const WATCHED = ['data-state', 'aria-checked', 'aria-current', 'aria-selected'];

/**
 * Glides one shared pill behind whichever child is active. Give the host the class `pill-host`
 * (and position:relative comes with it); the CSS in index.css draws and animates the pill from the
 * variables this hook keeps current as the selection, the layout or the content changes.
 */
export function useActivePill<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const measure = () => {
      const el = host.querySelector<HTMLElement>(ACTIVE);
      if (!el || el.offsetWidth === 0) {
        delete host.dataset.pill;
        return;
      }
      host.style.setProperty('--pill-x', `${el.offsetLeft}px`);
      host.style.setProperty('--pill-y', `${el.offsetTop}px`);
      host.style.setProperty('--pill-w', `${el.offsetWidth}px`);
      host.style.setProperty('--pill-h', `${el.offsetHeight}px`);
      host.dataset.pill = 'ready';
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(host);
    for (const child of Array.from(host.children)) resize.observe(child);
    const mutate = new MutationObserver(measure);
    mutate.observe(host, { attributes: true, attributeFilter: WATCHED, subtree: true, childList: true });
    return () => {
      resize.disconnect();
      mutate.disconnect();
    };
  }, []);
  return ref;
}
