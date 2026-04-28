import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Pencil, LayoutDashboard } from "lucide-react";
import { MODELS, PROVIDERS, AUTO_MODEL_ID, type Provider } from "@/lib/models";
import { ProviderLogo } from "./ProviderLogo";

export type SlashItem = {
  provider: Provider | "auto" | "write" | "explore" | "page";
  model: string;
  label: string;
  description: string;
  /** lowercase label without spaces, used for /xxx matching */
  slug: string;
};

/** Build the full list of selectable items (Auto + Write + all models). */
export function buildSlashItems(): SlashItem[] {
  const items: SlashItem[] = [
    {
      provider: "auto",
      model: AUTO_MODEL_ID,
      label: "Auto",
      description: "Pick the best model for me",
      slug: "auto",
    },
    {
      provider: "write",
      model: "",
      label: "Note",
      description: "Open an editable canvas for drafting",
      slug: "note",
    },
    {
      provider: "explore",
      model: "",
      label: "Explore",
      description: "Open a side exploration for this request",
      slug: "explore",
    },
    {
      provider: "page",
      model: "",
      label: "Page",
      description: "Generate a structured one-pager dashboard",
      slug: "page",
    },
  ];
  for (const p of PROVIDERS) {
    for (const m of MODELS[p.id]) {
      items.push({
        provider: p.id,
        model: m.id,
        label: m.label,
        description: m.description,
        slug: m.label.toLowerCase().replace(/[^a-z0-9]/g, ""),
      });
    }
  }
  return items;
}

export function filterSlashItems(query: string): SlashItem[] {
  const items = buildSlashItems();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return items;
  return items.filter(
    (it) =>
      it.slug.includes(q) ||
      it.label.toLowerCase().includes(query.toLowerCase()) ||
      it.model.toLowerCase().includes(q),
  );
}

type Props = {
  query: string;
  position: { left: number; top: number } | null;
  onSelect: (item: SlashItem) => void;
  onClose: () => void;
  /** Optional — hide items whose `provider` matches one of these. */
  excludeProviders?: SlashItem["provider"][];
  /** Optional — disabled mode ids (note/page/explore). Hidden from the menu. */
  disabledModes?: ReadonlyArray<"note" | "page" | "explore">;
  /** Optional — model ids to hide entirely (blacklist). */
  blacklistedModels?: ReadonlyArray<string>;
  /** Optional — favorite model ids, surfaced first. */
  favoriteModels?: ReadonlyArray<string>;
};

export function SlashCommandMenu({
  query,
  position,
  onSelect,
  onClose,
  excludeProviders,
  disabledModes,
  blacklistedModels,
  favoriteModels,
}: Props) {
  const items = useMemo(() => {
    let all = filterSlashItems(query);
    if (excludeProviders?.length) {
      all = all.filter((it) => !excludeProviders.includes(it.provider));
    }
    if (disabledModes?.length) {
      const disabled = new Set(disabledModes);
      all = all.filter((it) => {
        if (it.provider === "write" && disabled.has("note")) return false;
        if (it.provider === "page" && disabled.has("page")) return false;
        if (it.provider === "explore" && disabled.has("explore")) return false;
        return true;
      });
    }
    if (blacklistedModels?.length) {
      const blk = new Set(blacklistedModels);
      all = all.filter((it) => !it.model || !blk.has(it.model));
    }
    if (favoriteModels?.length) {
      const favRank = new Map(favoriteModels.map((m, i) => [m, i] as const));
      all = [...all].sort((a, b) => {
        const ai = favRank.has(a.model) ? favRank.get(a.model)! : Infinity;
        const bi = favRank.has(b.model) ? favRank.get(b.model)! : Infinity;
        return ai - bi;
      });
    }
    return all;
  }, [query, excludeProviders, disabledModes, blacklistedModels, favoriteModels]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset active index when query changes
  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keyboard navigation handled at the textarea level via custom events
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!items.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a - 1 + items.length) % items.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onSelect(items[active]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [items, active, onSelect, onClose]);

  // Scroll the active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!position || !items.length) return null;

  return (
    <div
      ref={listRef}
      role="listbox"
      className="absolute z-50 w-72 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
      style={{ left: position.left, top: position.top, transform: "translateY(-100%)" }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it, idx) => {
        const isActive = idx === active;
        return (
          <button
            key={`${it.provider}-${it.model}`}
            data-idx={idx}
            type="button"
            role="option"
            aria-selected={isActive}
            onMouseEnter={() => setActive(idx)}
            onClick={() => onSelect(it)}
            className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
              isActive ? "bg-dropdown-hover" : ""
            }`}
          >
            <span className="inline-flex items-center justify-center w-4 h-4 shrink-0">
              {it.provider === "auto" ? (
                <Sparkles className="w-4 h-4 text-muted-foreground" />
              ) : it.provider === "write" ? (
                <Pencil className="w-4 h-4 text-muted-foreground" />
              ) : it.provider === "explore" ? (
                <Sparkles className="w-4 h-4 text-muted-foreground" />
              ) : it.provider === "page" ? (
                <LayoutDashboard className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ProviderLogo provider={it.provider as Provider} className="w-4 h-4" />
              )}
            </span>
            <span className="text-[13px] text-foreground truncate">{it.label}</span>
          </button>);
      })}
    </div>
  );
}
