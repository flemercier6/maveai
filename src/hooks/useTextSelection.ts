import { useEffect, useState } from "react";

export type SelectionInfo = {
  text: string;
  rect: DOMRect;
  // The closest assistant message element (carries data-message-id).
  messageId: string | null;
};

/**
 * Observe the window selection and return info when the user selects text
 * inside an element matching `scopeSelector`. Returns null when selection
 * is empty or collapsed.
 */
export function useTextSelection(scopeSelector: string): SelectionInfo | null {
  const [info, setInfo] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    const compute = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setInfo(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        setInfo(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const anchorNode = range.commonAncestorContainer as Node;
      const anchorEl =
        anchorNode.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as Element)
          : anchorNode.parentElement;
      if (!anchorEl) {
        setInfo(null);
        return;
      }
      const scoped = anchorEl.closest(scopeSelector);
      if (!scoped) {
        setInfo(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const messageId =
        (scoped.getAttribute("data-message-id")) || null;
      setInfo({ text, rect, messageId });
    };

    const onUp = () => {
      // Defer so the selection is finalized.
      setTimeout(compute, 0);
    };
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setInfo(null);
    };

    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [scopeSelector]);

  return info;
}
