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
    <svg width="7" height="7" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M46.2841 28.791L43.1206 30.8126C42.9757 30.9224 42.8917 31.0017 42.718 31.0615C38.5012 34.029 33.4377 38.7231 30.7953 43.2188C29.9746 44.3604 29.2448 45.5267 28.4979 46.7205L28.4406 46.8121C27.6916 48.0092 26.7316 49.8525 25.1416 49.9906C22.9295 50.1819 21.8144 47.4043 20.8017 45.8048C19.7521 44.1412 18.6486 42.5123 17.493 40.9206C15.321 37.9499 12.3762 35.0874 9.51224 32.7892C8.53164 32.0023 7.21686 31.283 6.29084 30.5015L2.91389 28.3673C1.86706 27.7079 0.367053 27.0721 0.0981471 25.7489C-0.235328 24.1075 0.280591 23.2095 1.65193 22.3322C4.16133 20.7269 6.83944 19.1994 9.19392 17.3676C13.0804 14.3729 16.4414 10.751 19.1387 6.65098C19.9674 5.4164 20.8406 4.03178 21.6083 2.76099C23.0519 0.371128 23.7252 -0.670948 26.6569 0.452658C27.4327 1.37749 28.1352 2.59778 28.7877 3.63747C29.5961 4.93501 30.43 6.21635 31.289 7.48087C35.0084 12.9774 40.049 17.381 45.7457 20.8034C47.9667 22.1378 52.1375 24.1027 48.6774 27.217C48.0595 27.7731 47.0156 28.3323 46.2841 28.791Z" fill="#9C4CFF"/>
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
