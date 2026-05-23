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

const LockIcon = () => (
  <svg width="9" height="10" viewBox="0 0 8 9" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    <path d="M3.5 6.25001C3.5 6.49854 3.70147 6.70001 3.95 6.70001C4.19853 6.70001 4.4 6.49854 4.4 6.25001H3.95H3.5ZM4.4 5.45001C4.4 5.20148 4.19853 5.00001 3.95 5.00001C3.70147 5.00001 3.5 5.20148 3.5 5.45001H3.95H4.4ZM0.567164 7.18789L1.01236 7.12233L1.01236 7.12233L0.567164 7.18789ZM2.00735 8.41037L1.98845 8.85997L1.98846 8.85998L2.00735 8.41037ZM5.89263 8.41037L5.91152 8.85998L5.91153 8.85997L5.89263 8.41037ZM7.33283 7.18789L7.77803 7.25346L7.77804 7.25343L7.33283 7.18789ZM7.33283 4.51213L7.77804 4.4466L7.77803 4.44657L7.33283 4.51213ZM5.89263 3.28965L5.91153 2.84005L5.91153 2.84004L5.89263 3.28965ZM2.00735 3.28965L1.98845 2.84004L1.98845 2.84005L2.00735 3.28965ZM0.567164 4.51213L1.01236 4.57769L1.01236 4.57769L0.567164 4.51213ZM1.53125 3.25001C1.53125 3.49854 1.73272 3.70001 1.98125 3.70001C2.22978 3.70001 2.43125 3.49854 2.43125 3.25001H1.98125H1.53125ZM5.46875 3.25001C5.46875 3.49854 5.67022 3.70001 5.91875 3.70001C6.16728 3.70001 6.36875 3.49854 6.36875 3.25001H5.91875H5.46875ZM3.95 6.25001H4.4V5.45001H3.95H3.5V6.25001H3.95ZM0.567164 7.18789L0.121965 7.25345C0.254812 8.1556 1.05718 8.82083 1.98845 8.85997L2.00735 8.41037L2.02625 7.96077C1.48442 7.93799 1.07629 7.55642 1.01236 7.12233L0.567164 7.18789ZM2.00735 8.41037L1.98846 8.85998C2.6147 8.88629 3.25058 8.90001 3.95 8.90001V8.45001V8.00001C3.26281 8.00001 2.63954 7.98654 2.02624 7.96077L2.00735 8.41037ZM3.95 8.45001V8.90001C4.64942 8.90001 5.28529 8.88629 5.91152 8.85998L5.89263 8.41037L5.87374 7.96077C5.26045 7.98654 4.63719 8.00001 3.95 8.00001V8.45001ZM5.89263 8.41037L5.91153 8.85997C6.84283 8.82083 7.64517 8.1556 7.77803 7.25346L7.33283 7.18789L6.88764 7.12233C6.82371 7.55642 6.41558 7.93799 5.87373 7.96077L5.89263 8.41037ZM7.33283 7.18789L7.77804 7.25343C7.8432 6.81077 7.9 6.33822 7.9 5.85001H7.45H7C7 6.27189 6.95083 6.69302 6.88763 7.12236L7.33283 7.18789ZM7.45 5.85001H7.9C7.9 5.36181 7.8432 4.88926 7.77804 4.4466L7.33283 4.51213L6.88763 4.57767C6.95083 5.00701 7 5.42814 7 5.85001H7.45ZM7.33283 4.51213L7.77803 4.44657C7.64517 3.54443 6.84283 2.87919 5.91153 2.84005L5.89263 3.28965L5.87373 3.73925C6.41558 3.76203 6.82371 4.1436 6.88764 4.5777L7.33283 4.51213ZM5.89263 3.28965L5.91153 2.84004C5.28528 2.81372 4.64942 2.80001 3.95 2.80001V3.25001V3.70001C4.63719 3.70001 5.26045 3.71348 5.87373 3.73925L5.89263 3.28965ZM3.95 3.25001V2.80001C3.25058 2.80001 2.6147 2.81372 1.98845 2.84004L2.00735 3.28965L2.02624 3.73925C2.63953 3.71348 3.2628 3.70001 3.95 3.70001V3.25001ZM2.00735 3.28965L1.98845 2.84005C1.05718 2.87919 0.254812 3.54443 0.121965 4.44657L0.567164 4.51213L1.01236 4.57769C1.07629 4.1436 1.48443 3.76203 2.02625 3.73925L2.00735 3.28965ZM0.567164 4.51213L0.121965 4.44657C0.0567708 4.88927 -3.03984e-06 5.36181 -3.03984e-06 5.85001H0.449997H0.899997C0.899997 5.42813 0.949142 5.00699 1.01236 4.57769L0.567164 4.51213ZM0.449997 5.85001H-3.03984e-06C-3.03984e-06 6.33821 0.0567708 6.81075 0.121965 7.25345L0.567164 7.18789L1.01236 7.12233C0.949142 6.69303 0.899997 6.27189 0.899997 5.85001H0.449997ZM1.98125 3.25001H2.43125V2.25001H1.98125H1.53125V3.25001H1.98125ZM1.98125 2.25001H2.43125C2.43125 1.54153 3.07241 0.900012 3.95 0.900012V0.450012V1.2219e-05C2.65297 1.2219e-05 1.53125 0.970266 1.53125 2.25001H1.98125ZM3.95 0.450012V0.900012C4.82759 0.900012 5.46875 1.54153 5.46875 2.25001H5.91875H6.36875C6.36875 0.970267 5.24704 1.2219e-05 3.95 1.2219e-05V0.450012ZM5.91875 2.25001H5.46875V3.25001H5.91875H6.36875V2.25001H5.91875Z" fill="#888888"/>
  </svg>
);

const PlusBadge = () => (
  <span
    className="inline-flex items-center leading-none"
    style={{ background: "#F7EBFF", color: "#9C4CFF", fontSize: "10px", fontWeight: 400, borderRadius: "50px", padding: "3px 5px", gap: "3px" }}
  >
    <svg width="6" height="6" viewBox="0 0 50 50" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
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
          locked ? <span className="inline-flex items-center" style={{ gap: "5px" }}><LockIcon /><PlusBadge /></span> :
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
