/**
 * useMousePosition — Tracks mouse position relative to an element's bounding box
 * and injects CSS custom properties (--mouse-x, --mouse-y) directly into
 * the element's inline style to avoid React re-renders.
 */

import { useCallback, useRef } from 'react';

export function useMousePosition<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);

  const onMouseMove = useCallback((e: React.MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    el.style.setProperty('--mouse-x', `${x}px`);
    el.style.setProperty('--mouse-y', `${y}px`);
  }, []);

  const onMouseLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty('--mouse-x');
    el.style.removeProperty('--mouse-y');
  }, []);

  return { ref, onMouseMove, onMouseLeave };
}
