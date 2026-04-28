// Right-side overlay panel that renders a generated PageSpec.
// • Distinct visual identity: warm paper surface, grain, display serif
// • Resizable width via a left-edge drag handle (persists in localStorage)
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageRenderer, type PageSpec } from "./PageRenderer";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  page: PageSpec | null;
  onClose: () => void;
};

const STORAGE_KEY = "page-panel-width";
const MIN_W = 480;
const MAX_W_RATIO = 0.95; // up to 95vw

export function PagePanel({ open, page, onClose }: Props) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return 720;
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= MIN_W) return stored;
    return Math.min(Math.max(window.innerWidth * 0.6, MIN_W), 1100);
  });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const clamp = useCallback((w: number) => {
    const max = Math.max(MIN_W, window.innerWidth * MAX_W_RATIO);
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
    // Dragging left increases width (panel grows toward the left edge).
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

  // Keep within viewport on resize.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  // Disable text selection while dragging.
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

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-[#1B1A17]/40 backdrop-blur-[2px] transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden
      />
      {/* Panel */}
      <aside
        className={cn(
          "fixed top-0 right-0 z-50 h-full page-surface overflow-hidden",
          "shadow-[-24px_0_60px_-20px_rgba(27,26,23,0.35)]",
          dragging ? "transition-none" : "transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          open ? "translate-x-0" : "translate-x-full",
        )}
        style={{ width: `${width}px`, maxWidth: "95vw" }}
        role="dialog"
        aria-label="Generated page"
      >
        {/* Resize handle (left edge) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize page panel"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn(
            "absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 z-10 cursor-col-resize group",
          )}
        >
          <div
            className={cn(
              "absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[#1B1A17]/15 transition-colors",
              "group-hover:bg-[#E85A2F] group-hover:w-[2px]",
              dragging && "bg-[#E85A2F] w-[2px]",
            )}
          />
          {/* Pill grip */}
          <div
            className={cn(
              "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-1 rounded-full bg-[#1B1A17]/30 transition-all",
              "group-hover:bg-[#E85A2F] group-hover:h-14",
              dragging && "bg-[#E85A2F] h-14",
            )}
          />
        </div>

        <div className="page-grain" />
        {/* Header bar */}
        <div className="relative flex items-center justify-between px-7 h-14 border-b border-[#1B1A17]/15">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#E85A2F]" />
              <span className="h-2 w-2 rounded-full bg-[#B48441]" />
              <span className="h-2 w-2 rounded-full bg-[#2E4057]" />
            </div>
            <div className="font-grotesk text-[10px] uppercase tracking-[0.28em] text-[#1B1A17]/55 truncate">
              {page?.title ?? "Page"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close page"
            className="h-8 w-8 inline-flex items-center justify-center rounded-full text-[#1B1A17]/70 hover:bg-[#1B1A17]/8 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative h-[calc(100%-3.5rem)] overflow-y-auto">
          {page ? (
            <PageRenderer page={page} />
          ) : (
            <div className="p-10 font-display text-2xl text-[#1B1A17]/50 italic">No page yet.</div>
          )}
        </div>
      </aside>
    </>
  );
}
