// Right-side panel that renders a generated PageSpec.
// Sits beside the main chat (no overlay/backdrop) — the chat container shrinks via paddingRight.
// • Distinct visual identity per-theme (warm paper, midnight, minimal, forest, slate)
// • Resizable width via a left-edge drag handle (persists in localStorage)
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageRenderer, type PageSpec } from "./PageRenderer";
import { SharePageButton } from "./SharePageButton";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  page: PageSpec | null;
  pageKey?: string;
  onClose: () => void;
  onWidthChange?: (width: number) => void;
};

const STORAGE_KEY = "page-panel-width";
const MIN_W = 520;

export function PagePanel({ open, page, pageKey, onClose, onWidthChange }: Props) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 900;
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= MIN_W) return stored;
    return Math.min(Math.round(window.innerWidth * 0.68), 1200);
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const clamp = useCallback((w: number) => {
    const max = Math.max(MIN_W, window.innerWidth * 0.92);
    return Math.min(Math.max(w, MIN_W), max);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startW: width };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const delta = dragRef.current.startX - e.clientX;
    setWidth(clamp(dragRef.current.startW + delta));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
    try { window.localStorage.setItem(STORAGE_KEY, String(width)); } catch { /* ignore */ }
  };

  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  useEffect(() => {
    if (!dragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prev;
      document.body.style.cursor = "";
    };
  }, [dragging]);

  useEffect(() => {
    onWidthChange?.(width);
  }, [width, onWidthChange]);

  // Determine theme for header colors
  const theme = page?.theme ?? "paper";
  const headerBorder =
    theme === "midnight" ? "border-white/10" :
    theme === "minimal"  ? "border-gray-200" :
    theme === "forest"   ? "border-white/10" :
    theme === "slate"    ? "border-slate-200" :
    "border-[#1B1A17]/15";
  const headerText =
    theme === "midnight" ? "text-white/50" :
    theme === "forest"   ? "text-white/50" :
    "text-[#1B1A17]/55";
  const closeBtn =
    theme === "midnight" ? "text-white/60 hover:bg-white/10" :
    theme === "forest"   ? "text-white/60 hover:bg-white/10" :
    "text-[#1B1A17]/60 hover:bg-[#1B1A17]/8";

  return (
    <div
      style={{ width, maxWidth: "100vw" }}
      className={cn(
        "fixed top-0 right-0 bottom-0 z-40",
        "bg-sidebar",
        "p-[10px]",
        dragging ? "transition-none" : "transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize page panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute left-0 top-0 bottom-0 w-[10px] cursor-col-resize z-10"
      />

      {/* Inner panel */}
      <div className="relative flex flex-col h-full overflow-hidden rounded-[12px] page-grain-wrapper">
        {page && <div className="page-grain absolute inset-0 rounded-[12px] pointer-events-none" />}

        {/* Dynamic background per theme */}
        <div
          className={cn(
            "absolute inset-0 rounded-[12px]",
            theme === "midnight" ? "bg-[#0F1624]" :
            theme === "minimal"  ? "bg-white" :
            theme === "forest"   ? "bg-[#0D1F1A]" :
            theme === "slate"    ? "bg-[#F4F6F8]" :
            "page-surface",
          )}
        />

        {/* Header */}
        <div className={cn("relative flex items-center gap-3 px-4 h-14 border-b shrink-0", headerBorder)}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close page"
            className={cn("h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-full transition-colors", closeBtn)}
          >
            <X className="w-4 h-4" />
          </button>
          <div className={cn("font-grotesk text-[10px] uppercase tracking-[0.28em] truncate", headerText)}>
            {page?.title ?? "Page"}
          </div>
        </div>

        {/* Content */}
        <div className="relative flex-1 overflow-y-auto">
          {page ? (
            <PageRenderer page={page} />
          ) : (
            <div className="p-10 font-display text-2xl text-[#1B1A17]/50 italic">No page yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
