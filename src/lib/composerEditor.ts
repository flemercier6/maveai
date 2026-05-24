import gmailLogoUrl from "@/assets/logo-gmail.png";
import calendarLogoUrl from "@/assets/logo-calendar.png";
import driveLogoUrl from "@/assets/logo-drive.png";
import voyagerLogoUrl from "@/assets/logo-voyager.png";

export type ChipKind = "gmail" | "calendar" | "drive" | "voyager";

export const CHIP_META: Record<ChipKind, { label: string; src: string }> = {
  gmail: { label: "Gmail", src: gmailLogoUrl },
  calendar: { label: "Calendar", src: calendarLogoUrl },
  drive: { label: "Drive", src: driveLogoUrl },
  voyager: { label: "Voyager CRM", src: voyagerLogoUrl },
};

/** Build an atomic chip span (contenteditable=false) for inline display. */
export function buildChipElement(kind: ChipKind): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute("data-chip", kind);
  span.setAttribute("contenteditable", "false");
  span.className =
    "inline-flex items-center align-middle gap-1 font-medium select-none mx-[1px]";
  span.style.color = "#0062FF";
  const img = document.createElement("img");
  img.src = CHIP_META[kind].src;
  img.alt = CHIP_META[kind].label;
  img.className = "w-4 h-4 inline-block";
  img.draggable = false;
  span.appendChild(img);
  span.appendChild(document.createTextNode(CHIP_META[kind].label));
  return span;
}

/** Read text content of editor, ignoring chip subtrees, mapping <br> to \n. */
export function readEditorText(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.hasAttribute && el.hasAttribute("data-chip")) return;
      if (el.nodeName === "BR") {
        out += "\n";
        return;
      }
    }
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue || "";
      return;
    }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

/** List chip kinds currently present in the editor, in document order. */
export function listChips(root: HTMLElement): ChipKind[] {
  return Array.from(root.querySelectorAll("[data-chip]")).map(
    (el) => el.getAttribute("data-chip") as ChipKind,
  );
}

/** Caret offset within the visible text (chips count as 0 chars). */
export function getCaretOffsetInText(root: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return readEditorText(root).length;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return readEditorText(root).length;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  const tmp = document.createElement("div");
  tmp.appendChild(pre.cloneContents());
  return readEditorText(tmp).length;
}

/** Place caret at the end of the editor. */
export function setCaretAtEnd(root: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Replace editor contents with a single text node and place caret at end. */
export function setEditorText(root: HTMLElement, text: string) {
  root.innerHTML = "";
  if (text) root.appendChild(document.createTextNode(text));
  setCaretAtEnd(root);
}

/**
 * Insert a chip at the current selection, optionally removing `removeLen`
 * characters of text immediately before the caret (used to strip the typed
 * "@gma" trigger). Caret is positioned after a trailing space.
 */
export function insertChipAtCaret(
  root: HTMLElement,
  kind: ChipKind,
  removeLen: number,
) {
  let sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.getRangeAt(0).endContainer)) {
    root.focus();
    setCaretAtEnd(root);
    sel = window.getSelection();
  }
  if (!sel || sel.rangeCount === 0) {
    root.appendChild(buildChipElement(kind));
    root.appendChild(document.createTextNode(" "));
    setCaretAtEnd(root);
    return;
  }
  const range = sel.getRangeAt(0);
  // Walk backwards across text nodes to remove `removeLen` chars before caret.
  let toDelete = removeLen;
  while (toDelete > 0) {
    const startNode = range.startContainer;
    if (startNode.nodeType === Node.TEXT_NODE) {
      const text = startNode as Text;
      const offset = range.startOffset;
      const cut = Math.min(toDelete, offset);
      range.setStart(text, offset - cut);
      toDelete -= cut;
      if (toDelete > 0) {
        let prev: Node | null = text.previousSibling;
        while (prev && prev.nodeType !== Node.TEXT_NODE) prev = null;
        if (!prev) break;
        range.setStart(prev, (prev.nodeValue || "").length);
      }
    } else {
      break;
    }
  }
  range.deleteContents();
  const chip = buildChipElement(kind);
  range.insertNode(chip);
  const space = document.createTextNode(" ");
  chip.after(space);
  const newRange = document.createRange();
  newRange.setStart(space, 1);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

/** Remove all chips matching one of `kinds` from the editor. */
export function removeChips(root: HTMLElement, kinds: ChipKind[]) {
  const set = new Set(kinds);
  root.querySelectorAll<HTMLElement>("[data-chip]").forEach((el) => {
    const k = el.getAttribute("data-chip") as ChipKind;
    if (set.has(k)) el.remove();
  });
}
