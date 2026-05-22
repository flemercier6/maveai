import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { MODELS, PROVIDERS, type Provider, providerForModel, AUTO_MODEL_ID } from "@/lib/models";
import { isPremiumModel } from "@/hooks/usePlan";
import { useAiPreferences } from "@/hooks/useAiPreferences";
import { ProviderLogo } from "./ProviderLogo";
import { Lock, Star } from "lucide-react";

const NewBadge = () => (
  <span
    className="leading-none"
    style={{ background: "#F0F6FF", color: "#0062FF", fontSize: "10px", fontWeight: 400, borderRadius: "50px", padding: "4px 10px" }}
  >
    New
  </span>
);

type Props = {
  provider: Provider;
  model: string;
  onChange: (p: Provider, m: string) => void;
  disabled?: boolean;
  isFree?: boolean;
  onPremiumLocked?: () => void;
};

export function ModelPicker({ provider, model, onChange, disabled, isFree, onPremiumLocked }: Props) {
  const isAuto = model === AUTO_MODEL_ID;
  const currentModel = MODELS[provider].find((m) => m.id === model);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const { prefs } = useAiPreferences();
  const blacklist = useMemo(() => new Set(prefs.blacklistedModels), [prefs.blacklistedModels]);
  const favRank = useMemo(
    () => new Map(prefs.favoriteModels.map((m, i) => [m, i] as const)),
    [prefs.favoriteModels],
  );

  // Build the flat ordered list of (provider, model) pairs.
  // Favorites first (in user-defined order), then the rest grouped by provider.
  const orderedModels = useMemo(() => {
    const flat: { p: Provider; m: typeof MODELS[Provider][number] }[] = [];
    for (const p of PROVIDERS) {
      for (const m of MODELS[p.id]) {
        if (blacklist.has(m.id)) continue;
        flat.push({ p: p.id, m });
      }
    }
    flat.sort((a, b) => {
      const ai = favRank.has(a.m.id) ? favRank.get(a.m.id)! : Infinity;
      const bi = favRank.has(b.m.id) ? favRank.get(b.m.id)! : Infinity;
      return ai - bi;
    });
    return flat;
  }, [blacklist, favRank]);

  const favoritesCount = orderedModels.filter((x) => favRank.has(x.m.id)).length;

  const showTip = (e: React.SyntheticEvent<HTMLElement>, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2, left: rect.left - 12 });
  };
  const hideTip = () => setTip(null);

  return (
    <>
      <Select
        value={model}
        onValueChange={(v) => {
          if (v === AUTO_MODEL_ID) {
            onChange(provider, AUTO_MODEL_ID);
            return;
          }
          if (isFree && isPremiumModel(v)) {
            onPremiumLocked?.();
            return;
          }
          const p = providerForModel(v);
          onChange(p, v);
        }}
        disabled={disabled}
        onOpenChange={(o) => { if (!o) hideTip(); }}
      >
        <SelectTrigger className="w-auto min-w-0 h-9 border-0 bg-transparent gap-2 text-base rounded-[50px] hover:bg-dropdown-hover focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0">
          <SelectValue>
            <span className="flex items-center gap-1.5 leading-none">
              {!isAuto && (
                <ProviderLogo provider={provider} className="w-4 h-4 shrink-0" />
              )}
              <span className="leading-none">{isAuto ? "Auto" : (currentModel?.label ?? model)}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="end" className="w-[260px]">
          <SelectItem
            value={AUTO_MODEL_ID}
            className="p-[5px] min-h-[50px] bg-[#F8F7F5] data-[state=checked]:bg-[#F8F7F5] focus:bg-[#F8F7F5]"
          >
            <span className="flex items-center gap-2">
              <span className="flex flex-col leading-tight">
                <span className="leading-none">Auto</span>
                <span className="text-[10px] text-muted-foreground font-normal mt-0.5">Pick the best model for your request</span>
              </span>
            </span>
          </SelectItem>
          <SelectSeparator className="mt-[5px]" />
          {orderedModels.map(({ p, m }, idx) => {
            const locked = isFree && isPremiumModel(m.id);
            const isFav = favRank.has(m.id);
            // Insert a separator between favorites and the rest of the list.
            const showFavSep = favoritesCount > 0 && idx === favoritesCount;
            return (
              <span key={m.id}>
                {showFavSep && <SelectSeparator />}
                <SelectItem
                  value={m.id}
                  onMouseEnter={(e) => showTip(e, locked ? "Plus only" : m.description)}
                  onMouseLeave={hideTip}
                  onFocus={(e) => showTip(e, locked ? "Plus only" : m.description)}
                  onBlur={hideTip}
                  className={locked ? "opacity-60" : undefined}
                >
                  <span className="flex w-full items-center gap-2 leading-none">
                    <ProviderLogo provider={p} className="w-5 h-5 shrink-0" />
                    <span className="leading-none text-base">{m.label}</span>
                    {isFav && (
                      <Star className="w-3 h-3 text-amber-500 fill-current shrink-0" />
                    )}
                    <span className="flex-1" />
                    {m.id === "gemini-3.5-flash" && <NewBadge />}
                    {locked && (
                      <span className="ml-1 inline-flex items-center gap-0.5 rounded-sm bg-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-foreground/70 leading-none">
                        <Lock className="w-2.5 h-2.5" /> Plus
                      </span>
                    )}
                  </span>
                </SelectItem>
              </span>
            );
          })}
        </SelectContent>
      </Select>

      {tip &&
        createPortal(
          <div
            style={{ position: "fixed", top: tip.top, left: tip.left, transform: "translate(-100%, -50%)" }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded-[4px] bg-tooltip px-2 py-1 text-xs text-tooltip-foreground shadow-md"
          >
            {tip.text}
          </div>,
          document.body,
        )}
    </>
  );
}
