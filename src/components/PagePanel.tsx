// Right-side overlay panel that renders a generated PageSpec.
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
          "fixed inset-0 z-40 bg-black/30 transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
        aria-hidden
      />
      {/* Panel */}
      <aside
        className={cn(
          "fixed top-0 right-0 z-50 h-full bg-background border-l border-border shadow-2xl",
          "w-full sm:w-[60vw] sm:min-w-[560px] sm:max-w-[1100px]",
          "transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-label="Generated page"
      >
        <div className="flex items-center justify-between px-5 h-12 border-b border-border">
          <div className="text-sm font-medium text-muted-foreground truncate">
            {page?.title ?? "Page"}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
            aria-label="Close page"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="h-[calc(100%-3rem)] overflow-y-auto px-6 py-6">
          {page ? (
            <PageRenderer page={page} />
          ) : (
            <div className="text-sm text-muted-foreground">No page yet.</div>
          )}
        </div>
      </aside>
    </>
  );
}
