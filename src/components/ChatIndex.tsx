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

  if (items.length < 2) return null;

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
      className="absolute bottom-4 left-4 z-30"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className={cn(
          "flex flex-col bg-[hsl(var(--dropdown-hover))] select-none transition-[padding,border-radius,min-width,max-width] duration-300 ease-out gap-0",
          hovered
            ? "rounded-2xl shadow-md py-3 pl-3 pr-3 min-w-[220px] max-w-[300px] items-stretch"
            : "rounded-[25px] py-2 px-2 items-center",
        )}
      >
        {items.map((it) => {
          const isActive = it.id === activeId;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => scrollTo(it.id)}
              aria-label={`Jump to: ${it.preview}`}
              className={cn(
                "group flex items-center outline-none rounded-md transition-[height,padding,background-color,gap] duration-300 ease-out",
                hovered
                  ? cn(
                  "self-stretch justify-start px-2 h-7 gap-2",
                      isActive ? "bg-black/10" : "hover:bg-black/5",
                    )
                  : "h-[10px] gap-0 justify-center",
              )}
            >
              <span
                className={cn(
                  "block rounded-full shrink-0 h-[2px] transition-all duration-200",
                  isActive
                    ? "bg-foreground w-5"
                    : "bg-foreground/40 group-hover:bg-foreground/70 w-[15px]",
                )}
              />
              <span
                className={cn(
                  "truncate whitespace-nowrap text-left transition-[opacity,max-width] duration-300 ease-out text-xs font-sans font-semibold leading-5",
                  hovered
                    ? "opacity-100 max-w-[240px]"
                    : "opacity-0 max-w-0",
                  isActive ? "text-foreground" : "text-foreground/60 group-hover:text-foreground",
                )}
              >
                {it.preview.charAt(0).toUpperCase() + it.preview.slice(1)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
