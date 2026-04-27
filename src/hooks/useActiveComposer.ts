import { useEffect, useState } from "react";

/**
 * Tiny shared store to track which chat composer is currently focused
 * ("main" for the main chat, "explore" for the side panel). When one is
 * focused, the other can dim itself to make the active surface obvious.
 */
type ComposerId = "main" | "explore" | null;

let current: ComposerId = null;
const listeners = new Set<(v: ComposerId) => void>();

function setActive(v: ComposerId) {
  if (current === v) return;
  current = v;
  listeners.forEach((l) => l(v));
}

export function notifyComposerFocus(id: Exclude<ComposerId, null>) {
  setActive(id);
}

export function notifyComposerBlur(id: Exclude<ComposerId, null>) {
  // Only clear if we still own the active state.
  if (current === id) setActive(null);
}

export function useActiveComposer(): ComposerId {
  const [v, setV] = useState<ComposerId>(current);
  useEffect(() => {
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}
