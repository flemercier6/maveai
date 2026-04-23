import { useEffect, useRef, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import paragraphIcon from "@/assets/paragraph.svg";

type Item = { id: string; preview: string };

type Props = {
  items: Item[];
  scrollContainer: HTMLElement | null;
};

/**
 * Floating index of user prompts in the active chat.
 * Collapsed: black horizontal pill with [icon] "Index" [chevrons].
 * Expanded (on hover): reveals the list of prompts; click to scroll to that prompt.
 */
export function ChatIndex({ items, scrollContainer }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Track which prompt anchor is currently the closest to the top of the viewport.
  useEffect(() => {
    if (!scrollContainer || items.length === 0) {
      setActiveId(null);
      return;
    }

    const els = items
      .map((it) => document.getElementById(`chat-anchor-${it.id}`))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;

    const compute = () => {
      const containerRect = scrollContainer.getBoundingClientRect();
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top - (containerRect.top + 80));
        if (r.bottom > containerRect.top && dist < bestDist) {
          bestDist = dist;
          bestId = el.id.replace("chat-anchor-", "");
        }
      }
      if (!bestId) bestId = items[items.length - 1].id;
      setActiveId(bestId);
    };

    compute();
    scrollContainer.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      scrollContainer.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [items, scrollContainer]);

  if (items.length === 0) return null;

  const scrollTo = (id: string) => {
    const el = document.getElementById(`chat-anchor-${id}`);
    if (!el || !scrollContainer) return;
    const containerTop = scrollContainer.getBoundingClientRect().top;
    const elTop = el.getBoundingClientRect().top;
    scrollContainer.scrollTo({
      top: scrollContainer.scrollTop + (elTop - containerTop) - 24,
      behavior: "smooth",
    });
  };

  return (
    <div
      ref={wrapRef}
      className="fixed top-4 right-4 z-30 flex flex-col items-end gap-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Pill */}
      <div className="flex items-center bg-foreground text-background rounded-full h-9 pl-3 pr-2.5 cursor-default select-none">
        <img src={paragraphIcon} alt="" className="w-[13px] h-[9px]" />
        <span
          className="text-sm font-medium leading-none"
          style={{ marginLeft: 10 }}
        >
          Index
        </span>
        <ChevronsUpDown
          className="w-3.5 h-3.5 opacity-80"
          style={{ marginLeft: 10 }}
        />
      </div>

      {/* Expanded prompt list */}
      <div
        className={cn(
          "overflow-hidden transition-[max-height,opacity] duration-300 ease-out",
          hovered ? "max-h-[70vh] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <div className="flex flex-col items-stretch bg-foreground text-background rounded-2xl shadow-md py-3 px-3 gap-1 min-w-[200px] max-w-[280px]">
          {items.map((it) => {
            const isActive = it.id === activeId;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => scrollTo(it.id)}
                className={cn(
                  "text-left text-sm font-medium truncate rounded-md px-2 py-1 transition-colors",
                  isActive
                    ? "text-background bg-white/15"
                    : "text-background/60 hover:bg-white/10 hover:text-background",
                )}
                aria-label={`Jump to: ${it.preview}`}
              >
                {it.preview}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
