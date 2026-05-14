// Compact card shown in chat when a /page response is generated.
import { LayoutDashboard, ArrowUpRight } from "lucide-react";
import type { PageSpec } from "./PageRenderer";

type Props = {
  page: PageSpec;
  onOpen: () => void;
};

export function PageCard({ page, onOpen }: Props) {
  const tabCount = page.tabs?.length ?? 0;
  const blockCount = (page.tabs ?? []).reduce(
    (n, t) => n + (t.blocks?.length ?? 0),
    0,
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mt-3 w-full text-left rounded-xl border border-border bg-card hover:bg-dropdown-hover transition-colors p-4 flex items-center gap-3 group"
    >
      <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[#EFF6FF] text-[#0062FF] shrink-0">
        <LayoutDashboard className="w-4 h-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-foreground truncate">
          {page.title}
        </span>
        <span className="block text-muted-foreground text-sm mt-0.5 truncate">
          {tabCount > 1 ? `${tabCount} tabs · ` : ""}
          {blockCount} block{blockCount > 1 ? "s" : ""} · Click to open
        </span>
      </span>
      <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground shrink-0" />
    </button>
  );
}
