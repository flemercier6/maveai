import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from "@/components/ui/select";
import { MODELS, PROVIDERS, type Provider, providerForModel, AUTO_MODEL_ID } from "@/lib/models";
import { isPremiumModel } from "@/hooks/usePlan";
import { useAiPreferences } from "@/hooks/useAiPreferences";
import { ProviderLogo } from "./ProviderLogo";
import { Star } from "lucide-react";

const NewBadge = () => (
  <span
    className="leading-none"
    style={{ background: "#F0F6FF", color: "#0062FF", fontSize: "10px", fontWeight: 400, borderRadius: "50px", padding: "4px 10px" }}
  >
    New
  </span>
);

const PlusBadge = () => (
  <span
    className="inline-flex items-center leading-none"
    style={{ background: "#F7EBFF", color: "#9C4CFF", fontSize: "10px", fontWeight: 400, borderRadius: "50px", padding: "3px 5px", gap: "3px" }}
  >
    {/* sparkle icon at 7×7 */}
    <svg width="7" height="7" viewBox="0 0 7 7" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M3.5 0L4.16 2.34L6.5 3.5L4.16 4.66L3.5 7L2.84 4.66L0.5 3.5L2.84 2.34L3.5 0Z" fill="#9C4CFF"/>
    </svg>
    Plus
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

  const showTip = (e: React.SyntheticEvent<HTMLElement>, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2, left: rect.left - 12 });
  };
  const hideTip = () => setTip(null);

  // When isFree, split into locked (Plus) and free (Basic) sections
  const lockedModels = isFree ? orderedModels.filter(({ m }) => isPremiumModel(m.id)) : [];
  const freeModels = isFree ? orderedModels.filter(({ m }) => !isPremiumModel(m.id)) : orderedModels;

  const renderModelItem = ({ p, m }: { p: Provider; m: typeof MODELS[Provider][number] }, locked: boolean) => {
    const isFav = favRank.has(m.id);
    return (
      <SelectItem
        key={m.id}
        value={m.id}
        onMouseEnter={(e) => showTip(e, m.description)}
        onMouseLeave={hideTip}
        onFocus={(e) => showTip(e, m.description)}
        onBlur={hideTip}
        rightSlot={
          m.id === "gemini-3.5-flash" && !locked ? <NewBadge /> :
          locked ? <PlusBadge /> :
          undefined
        }
      >
        <span className="flex items-center gap-2 leading-none">
          <span className="inline-flex shrink-0 overflow-hidden" style={{ border: "1px solid #F8F7F5", borderRadius: "50%", opacity: locked ? 0.35 : 1 }}>
            <ProviderLogo provider={p} className="w-5 h-5" />
          </span>
          <span className="leading-none text-base" style={{ color: locked ? "rgba(0,0,0,0.3)" : undefined }}>
            {m.label}
          </span>
          {isFav && !locked && (
            <Star className="w-3 h-3 text-amber-500 fill-current shrink-0" />
          )}
        </span>
      </SelectItem>
    );
  };

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
          {/* Auto */}
          <SelectItem
            value={AUTO_MODEL_ID}
            className="p-[10px] min-h-[50px] bg-[#F8F7F5] data-[state=checked]:bg-[#F8F7F5] focus:bg-[#F8F7F5]"
          >
            <span className="flex items-center gap-2">
              <span className="flex flex-col leading-tight">
                <span className="leading-none">Auto</span>
                <span className="text-[10px] text-muted-foreground font-normal mt-0.5">Pick the best model for your request</span>
              </span>
            </span>
          </SelectItem>
          <SelectSeparator className="mt-[5px]" />

          {isFree ? (
            <>
              {lockedModels.map((item) => renderModelItem(item, true))}
              {freeModels.map((item) => renderModelItem(item, false))}
            </>
          ) : (
            orderedModels.map((item) => renderModelItem(item, false))
          )}
        </SelectContent>
      </Select>

      {tip &&
        createPortal(
          <div
            style={{ position: "fixed", top: tip.top, left: tip.left, transform: "translate(-100%, -50%)" }}
            className="pointer-events-none z-[100] whitespace-nowrap rounded-[10px] bg-tooltip px-[10px] py-[5px] text-[10px] font-normal text-tooltip-foreground shadow-md"
          >
            {tip.text}
          </div>,
          document.body,
        )}
    </>
  );
}
