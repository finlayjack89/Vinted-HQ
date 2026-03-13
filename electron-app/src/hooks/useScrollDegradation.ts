/**
 * useScrollDegradation — Detects high-velocity scrolling on a container
 * and temporarily removes the SVG filter reference (falling back to
 * Gaussian blur) to maintain 60fps. Re-engages the full filter after
 * scrolling stops.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const VELOCITY_THRESHOLD = 500;  // px/s
const SETTLE_DELAY_MS = 150;

export function useScrollDegradation() {
  const containerRef = useRef<HTMLElement | null>(null);
  const [isDegraded, setIsDegraded] = useState(false);
  const lastScrollTop = useRef(0);
  const lastScrollTime = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const now = performance.now();
    const dt = now - lastScrollTime.current;
    const dy = Math.abs(el.scrollTop - lastScrollTop.current);

    lastScrollTop.current = el.scrollTop;
    lastScrollTime.current = now;

    if (dt > 0) {
      const velocity = (dy / dt) * 1000; // px/s
      if (velocity > VELOCITY_THRESHOLD) {
        setIsDegraded(true);
      }
    }

    // Reset settle timer
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      setIsDegraded(false);
    }, SETTLE_DELAY_MS);
  }, []);

  const setContainerRef = useCallback((node: HTMLElement | null) => {
    // Detach from old node
    if (containerRef.current) {
      containerRef.current.removeEventListener('scroll', handleScroll);
    }
    containerRef.current = node;
    // Attach to new node
    if (node) {
      node.addEventListener('scroll', handleScroll, { passive: true });
    }
  }, [handleScroll]);

  useEffect(() => {
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('scroll', handleScroll);
      }
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, [handleScroll]);

  return { setContainerRef, isDegraded };
}
