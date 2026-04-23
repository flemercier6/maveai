import { useEffect, useRef, useState } from "react";

/**
 * Smoothly reveal `target` character-by-character at a steady pace using rAF.
 * - When `enabled` is false (stream finished), jumps to the full target instantly.
 * - Auto-accelerates if the gap between displayed and target grows too large,
 *   so we never fall behind the model's output.
 */
export function useSmoothText(target: string, enabled: boolean): string {
  const [displayed, setDisplayed] = useState(enabled ? "" : target);
  const displayedRef = useRef(displayed);
  const targetRef = useRef(target);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Keep refs in sync
  targetRef.current = target;
  displayedRef.current = displayed;

  useEffect(() => {
    // When streaming ends, snap to the full text immediately.
    if (!enabled) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (displayedRef.current !== target) {
        setDisplayed(target);
      }
      return;
    }

    // If target shrinks (new message), reset.
    if (!target.startsWith(displayedRef.current)) {
      setDisplayed("");
      displayedRef.current = "";
    }

    const tick = (now: number) => {
      const last = lastTimeRef.current || now;
      const dt = Math.min(now - last, 100); // cap big jumps (tab inactive, etc.)
      lastTimeRef.current = now;

      const cur = displayedRef.current;
      const tgt = targetRef.current;
      const remaining = tgt.length - cur.length;

      if (remaining <= 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Base speed: ~35 chars/sec. Accelerate as the buffer grows so we
      // never fall more than ~3s behind the actual stream.
      const baseCps = 35;
      const catchupBoost = Math.min(remaining / 60, 6); // up to 6x
      const cps = baseCps * (1 + catchupBoost);

      // How many chars to reveal this frame
      let toAdd = Math.max(1, Math.floor((cps * dt) / 1000));
      if (toAdd > remaining) toAdd = remaining;

      const next = tgt.slice(0, cur.length + toAdd);
      displayedRef.current = next;
      setDisplayed(next);

      rafRef.current = requestAnimationFrame(tick);
    };

    if (rafRef.current === null) {
      lastTimeRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [target, enabled]);

  return displayed;
}
