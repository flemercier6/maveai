import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Item = { id: string; preview: string };

type Props = {
  items: Item[];
  scrollContainer: HTMLElement | null;
};

/**
 * Floating vertical index of user prompts in the active chat.
 * - Collapsed: just a stack of horizontal ticks (25px wide).
 * - Hover: expands to reveal each prompt's start text on the left.
 * - Active prompt (the one currently in view) tick is black + wider; others are grey.
 * - Click on a row scrolls to that prompt.
 */
export function ChatIndex({ items, scrollContainer }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

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
        // Distance from the top of the scroll container (with a small offset).
        const dist = Math.abs(r.top - (containerRect.top + 80));
        if (r.bottom > containerRect.top && dist < bestDist) {
          bestDist = dist;
          bestId = el.id.replace("chat-anchor-", "");
        }
      }
      // Fallback: last one above the viewport
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
      className="fixed top-1/2 -translate-y-1/2 right-4 z-30"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex flex-col items-end justify-center gap-2 rounded-full bg-[hsl(0_0%_97%)] py-3 px-2 transition-all duration-200",
          hovered && "rounded-2xl shadow-md py-[30px] px-[2px] gap-[8px]",
        )}
      >
        {items.map((it) => {
          const isActive = it.id === activeId;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => scrollTo(it.id)}
              className="group flex items-center gap-2 outline-none"
              aria-label={`Jump to: ${it.preview}`}
            >
              {hovered && (
                <span
                  className={cn(
                    "max-w-[200px] truncate text-xs whitespace-nowrap",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {it.preview}
                </span>
              )}
              <span
                className={cn(
                  "block h-[2px] rounded-full transition-all duration-150",
                  isActive
                    ? "bg-foreground w-[32px]"
                    : "bg-muted-foreground/40 w-[25px] group-hover:bg-muted-foreground/70",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
