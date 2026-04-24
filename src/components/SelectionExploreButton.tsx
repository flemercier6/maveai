import { useEffect, useState } from "react";
import { Compass } from "lucide-react";

export type SelectionPayload = {
  text: string;
  messageId: string;
};

type Props = {
  /** Called when the user confirms "Explore" for the current selection. */
  onExplore: (payload: SelectionPayload) => void;
  /** When true, suppresses the button (e.g. the panel is already open). */
  disabled?: boolean;
};

/**
 * Self-contained floating "Explore" button that tracks the window text
 * selection inside assistant messages. Kept as its own component so its
 * internal state never re-renders the chat tree (which would wipe the
 * browser selection).
 */
export function SelectionExploreButton({ onExplore, disabled }: Props) {
  const [sel, setSel] = useState<{
    text: string;
    messageId: string;
    rect: { top: number; left: number; width: number };
  } | null>(null);

  useEffect(() => {
    if (disabled) {
      setSel(null);
      return;
    }

    const compute = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.rangeCount === 0) {
        setSel(null);
        return;
      }
      const text = s.toString().trim();
      if (!text) {
        setSel(null);
        return;
      }
      const range = s.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el =
        node.nodeType === Node.ELEMENT_NODE
          ? (node as Element)
          : node.parentElement;
      if (!el) {
        setSel(null);
        return;
      }
      const scoped = el.closest('[data-assistant-message="true"]');
      if (!scoped) {
        setSel(null);
        return;
      }
      const messageId = scoped.getAttribute("data-message-id") || "";
      if (!messageId) {
        setSel(null);
        return;
      }
      const r = range.getBoundingClientRect();
      setSel({
        text,
        messageId,
        rect: { top: r.top, left: r.left, width: r.width },
      });
    };

    const onUp = () => setTimeout(compute, 0);
    const onSelChange = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) setSel(null);
    };

    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("selectionchange", onSelChange);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("selectionchange", onSelChange);
    };
  }, [disabled]);

  if (!sel) return null;

  const top = Math.max(8, sel.rect.top - 40);
  const left = sel.rect.left + sel.rect.width / 2;

  return (
    <button
      type="button"
      // mousedown + preventDefault → keeps the selection alive and fires
      // before the browser's native selection collapse.
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const payload = { text: sel.text, messageId: sel.messageId };
        // Clear local state BEFORE calling back, so we unmount the button
        // immediately and don't race with the parent re-render.
        setSel(null);
        window.getSelection()?.removeAllRanges();
        onExplore(payload);
      }}
      className="fixed z-50 inline-flex items-center gap-1.5 rounded-full bg-foreground text-background px-3 py-1.5 text-xs font-medium shadow-lg animate-fade-in hover:opacity-90 transition-opacity"
      style={{ top, left, transform: "translateX(-50%)" }}
    >
      <Compass className="w-3.5 h-3.5" />
      Explore
    </button>
  );
}
