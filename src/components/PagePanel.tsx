// Right-side overlay panel that renders a generated PageSpec.
// Distinct visual identity: warm paper surface, grain, display serif.
import { X } from "lucide-react";
import { PageRenderer, type PageSpec } from "./PageRenderer";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  page: PageSpec | null;
  onClose: () => void;
};

export function PagePanel({ open, page, onClose }: Props) {
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
          "w-full sm:w-[60vw] sm:min-w-[560px] sm:max-w-[1100px]",
          "transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-label="Generated page"
      >
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
