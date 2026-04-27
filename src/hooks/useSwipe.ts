import { useEffect, useRef } from "react";

type Options = {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  /** Minimum horizontal distance in px to count as a swipe. */
  threshold?: number;
  /** Max vertical drift allowed relative to horizontal distance. */
  maxVerticalRatio?: number;
  /** Disable the listener entirely. */
  disabled?: boolean;
  /** Ignore swipes starting on these selectors (interactive/scrollable areas). */
  ignoreSelector?: string;
};

/**
 * Attach horizontal swipe gestures to a target element (defaults to window).
 * Touch-only — pointer/mouse drags are ignored to avoid clashing with text
 * selection and resize handles.
 */
export function useSwipe(
  targetRef: React.RefObject<HTMLElement> | null,
  {
    onSwipeLeft,
    onSwipeRight,
    threshold = 60,
    maxVerticalRatio = 0.6,
    disabled = false,
    ignoreSelector,
  }: Options,
) {
  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (disabled) return;
    const el: HTMLElement | Window = targetRef?.current ?? window;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        startRef.current = null;
        activeRef.current = false;
        return;
      }
      const t = e.touches[0];
      if (ignoreSelector && e.target instanceof Element && e.target.closest(ignoreSelector)) {
        startRef.current = null;
        activeRef.current = false;
        return;
      }
      startRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      activeRef.current = true;
    };

    const onEnd = (e: TouchEvent) => {
      const start = startRef.current;
      startRef.current = null;
      if (!activeRef.current || !start) return;
      activeRef.current = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const adx = Math.abs(dx);
      const ady = Math.abs(dy);
      if (adx < threshold) return;
      if (ady > adx * maxVerticalRatio) return;
      // Ignore very slow drags (>800ms) — likely not a swipe.
      if (Date.now() - start.t > 800) return;
      if (dx < 0) onSwipeLeft?.();
      else onSwipeRight?.();
    };

    el.addEventListener("touchstart", onStart as EventListener, { passive: true });
    el.addEventListener("touchend", onEnd as EventListener, { passive: true });
    el.addEventListener("touchcancel", () => { startRef.current = null; activeRef.current = false; });

    return () => {
      el.removeEventListener("touchstart", onStart as EventListener);
      el.removeEventListener("touchend", onEnd as EventListener);
    };
  }, [targetRef, onSwipeLeft, onSwipeRight, threshold, maxVerticalRatio, disabled, ignoreSelector]);
}
