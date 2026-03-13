/**
 * useCardTracker — DOM ↔ WebGL bridge for scroll-synced glass meshes
 *
 * PERFORMANCE-CRITICAL: This module bypasses React state entirely for
 * scroll/resize updates. Bounding boxes are stored in a mutable Map
 * accessed directly by the WebGL layer via a shared ref. Scroll offset
 * is tracked as a simple number mutation. No React re-renders during scroll.
 *
 * React state is only used for structural changes (cards added/removed).
 */

import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

/* ─── Types ──────────────────────────────────────────────── */

export interface TrackedRect {
  /** Initial x position (measured at mount time) */
  x: number;
  /** Initial y position (measured at mount time, before scroll offset) */
  y: number;
  width: number;
  height: number;
  /** Whether this element scrolls with <main> content */
  scrolls: boolean;
}

interface CardTrackerContextValue {
  /** Mutable map of all tracked card rects — read directly, no state */
  cardsRef: React.MutableRefObject<Map<string, TrackedRect>>;
  /** Mutable scroll offset of <main> — updated via direct mutation */
  scrollOffsetRef: React.MutableRefObject<number>;
  /** Register a card — only triggers re-render for structural changes */
  register: (id: string, rect: TrackedRect) => void;
  /** Unregister a card */
  unregister: (id: string) => void;
  /** Structural version — incremented only on add/remove, not scroll */
  version: number;
}

/* ─── Context ────────────────────────────────────────────── */

const CardTrackerContext = createContext<CardTrackerContextValue | null>(null);

export function CardTrackerProvider({ children }: { children: React.ReactNode }) {
  const cardsRef = useRef(new Map<string, TrackedRect>());
  const scrollOffsetRef = useRef(0);
  const [version, setVersion] = useState(0);

  // Register: called once per card mount + on resize (rare)
  const register = useCallback((id: string, rect: TrackedRect) => {
    const existing = cardsRef.current.get(id);
    // Only bump version if it's a NEW card (structural change)
    if (!existing) {
      cardsRef.current.set(id, rect);
      setVersion((v) => v + 1);
    } else {
      // Silent update — no re-render, just mutate the ref
      cardsRef.current.set(id, rect);
    }
  }, []);

  const unregister = useCallback((id: string) => {
    if (cardsRef.current.has(id)) {
      cardsRef.current.delete(id);
      setVersion((v) => v + 1);
    }
  }, []);

  // Global scroll listener — mutates scrollOffsetRef directly, NO re-renders
  useEffect(() => {
    const mainEl = document.querySelector('main');
    if (!mainEl) return;

    const onScroll = () => {
      scrollOffsetRef.current = mainEl.scrollTop;
    };

    mainEl.addEventListener('scroll', onScroll, { passive: true });
    // Initial read
    scrollOffsetRef.current = mainEl.scrollTop;

    return () => mainEl.removeEventListener('scroll', onScroll);
  }, []);

  // Global resize listener — remeasure all cards (rare event)
  useEffect(() => {
    const onResize = () => {
      // Force structural re-render to remeasure all cards
      setVersion((v) => v + 1);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const value: CardTrackerContextValue = {
    cardsRef,
    scrollOffsetRef,
    register,
    unregister,
    version,
  };

  return React.createElement(CardTrackerContext.Provider, { value }, children);
}

/* ─── Producer hook: attach to each card ─────────────────── */

/**
 * Returns a ref callback to attach to a DOM card element.
 * Measures the element ONCE on mount and registers it.
 * Does NOT re-measure on scroll — scroll offset is applied
 * as a global Y-offset in the WebGL scene.
 */
export function useTrackCard(id: string, scrolls = true) {
  const ctx = useContext(CardTrackerContext);
  const elRef = useRef<HTMLElement | null>(null);
  const measuredRef = useRef(false);

  const measure = useCallback(() => {
    if (!elRef.current || !ctx) return;
    const rect = elRef.current.getBoundingClientRect();
    const mainEl = document.querySelector('main');
    const scrollTop = mainEl ? mainEl.scrollTop : 0;

    ctx.register(id, {
      x: rect.x,
      // Store the absolute Y (accounting for current scroll position)
      y: rect.y + (scrolls ? scrollTop : 0),
      width: rect.width,
      height: rect.height,
      scrolls,
    });
    measuredRef.current = true;
  }, [id, ctx, scrolls]);

  const refCallback = useCallback(
    (node: HTMLElement | null) => {
      if (elRef.current && ctx) {
        ctx.unregister(id);
        measuredRef.current = false;
      }

      elRef.current = node;
      if (!node || !ctx) return;

      // Measure once, after layout
      requestAnimationFrame(() => measure());

      // Observe resize (rare — window resize, layout shift)
      const ro = new ResizeObserver(() => measure());
      ro.observe(node);

      (node as any).__glassCleanup = () => ro.disconnect();
    },
    [id, ctx, measure],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (elRef.current) {
        (elRef.current as any).__glassCleanup?.();
      }
      ctx?.unregister(id);
    };
  }, [id, ctx]);

  return refCallback;
}

/* ─── Consumer hook: read all tracked cards ──────────────── */

export function useTrackedCards() {
  const ctx = useContext(CardTrackerContext);
  if (!ctx) throw new Error('useTrackedCards must be used within CardTrackerProvider');
  return {
    cardsRef: ctx.cardsRef,
    scrollOffsetRef: ctx.scrollOffsetRef,
    version: ctx.version,
  };
}
