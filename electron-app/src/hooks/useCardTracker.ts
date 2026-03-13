/**
 * useCardTracker — DOM ↔ WebGL bridge for scroll-synced glass meshes
 *
 * Provides a React context that tracks DOM card bounding boxes and exposes
 * them to the WebGL canvas layer so glass refraction meshes can be positioned
 * precisely behind each card.
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
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CardTrackerContextValue {
  /** Register or update a card's bounding rect */
  set: (id: string, rect: TrackedRect) => void;
  /** Remove a card from tracking */
  remove: (id: string) => void;
  /** Current map of all tracked card rects */
  cards: Map<string, TrackedRect>;
  /** Incremented on every change — lets consumers know to re-read */
  version: number;
}

/* ─── Context ────────────────────────────────────────────── */

const CardTrackerContext = createContext<CardTrackerContextValue | null>(null);

export function CardTrackerProvider({ children }: { children: React.ReactNode }) {
  const cardsRef = useRef(new Map<string, TrackedRect>());
  const [version, setVersion] = useState(0);

  const set = useCallback((id: string, rect: TrackedRect) => {
    cardsRef.current.set(id, rect);
    setVersion((v) => v + 1);
  }, []);

  const remove = useCallback((id: string) => {
    cardsRef.current.delete(id);
    setVersion((v) => v + 1);
  }, []);

  const value: CardTrackerContextValue = {
    set,
    remove,
    cards: cardsRef.current,
    version,
  };

  return React.createElement(CardTrackerContext.Provider, { value }, children);
}

/* ─── Producer hook: attach to each card ─────────────────── */

/**
 * Returns a ref callback to attach to a DOM card element.
 * Uses IntersectionObserver + scroll listener to keep the
 * bounding rect updated in the CardTracker context.
 */
export function useTrackCard(id: string) {
  const ctx = useContext(CardTrackerContext);
  const elRef = useRef<HTMLElement | null>(null);
  const rafRef = useRef<number>(0);

  const updateRect = useCallback(() => {
    if (!elRef.current || !ctx) return;
    const rect = elRef.current.getBoundingClientRect();
    ctx.set(id, {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }, [id, ctx]);

  // Throttled scroll handler via rAF
  const onScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(updateRect);
  }, [updateRect]);

  const refCallback = useCallback(
    (node: HTMLElement | null) => {
      // Cleanup previous
      if (elRef.current && ctx) {
        ctx.remove(id);
      }

      elRef.current = node;

      if (!node || !ctx) return;

      // Initial measurement
      updateRect();

      // Observe visibility
      const io = new IntersectionObserver(
        () => updateRect(),
        { threshold: [0, 0.1, 0.5, 1] },
      );
      io.observe(node);

      // Observe resize
      const ro = new ResizeObserver(() => updateRect());
      ro.observe(node);

      // Store cleanup
      (node as any).__glassCleanup = () => {
        io.disconnect();
        ro.disconnect();
        cancelAnimationFrame(rafRef.current);
      };
    },
    [id, ctx, updateRect],
  );

  // Listen for scroll on the nearest scrollable ancestor
  useEffect(() => {
    // We listen on both window and the main content area
    const scrollContainer = document.querySelector('main');
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener('scroll', onScroll);
      }
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(rafRef.current);

      // Run element cleanup
      if (elRef.current) {
        (elRef.current as any).__glassCleanup?.();
        ctx?.remove(id);
      }
    };
  }, [id, ctx, onScroll]);

  return refCallback;
}

/* ─── Consumer hook: read all tracked cards ──────────────── */

export function useTrackedCards() {
  const ctx = useContext(CardTrackerContext);
  if (!ctx) throw new Error('useTrackedCards must be used within CardTrackerProvider');
  return { cards: ctx.cards, version: ctx.version };
}
